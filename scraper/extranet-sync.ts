/**
 * scraper/extranet-sync.ts — scheduled OTA extranet sync (Booking.com first).
 *
 * Flow:
 *   1. Load scraper/.env, decrypt scraper/cookies.<ota>.enc (AES-256-GCM).
 *   2. Launch Chromium via playwright-extra + puppeteer-extra-plugin-stealth
 *      (the ONLY evasion used — no custom fingerprint spoofing, no retries).
 *   3. Set cookies, navigate to the extranet, run detection checks:
 *        - session_expired   URL redirected to login/signin/auth
 *        - captcha_detected  recaptcha/hcaptcha iframe or "verify you are human" text
 *        - 2fa_challenge     verification-code inputs or two-factor/pin challenge text
 *        - blocked           HTTP 403/429 on the main navigation
 *        - parse_failure     page loaded but structure not recognized (detection too)
 *   4. ANY detection → ONE Telegram alert, exit 2. Never retry silently.
 *      Alert delivery failure → exit 3 (alert failure can never be silent).
 *   5. Success → extract bookings to normalized JSON, write
 *      artifacts/extranet-bookings.json, exit 0.
 *
 * Selector-level parsing is intentionally conservative: the Booking.com
 * extranet DOM changes often and has not yet been validated against a live
 * session. When the real structure diverges from the assumptions documented
 * in BOOKING_ADAPTER below, the run reports parse_failure instead of
 * silently writing an empty bookings file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import type { Page, Response } from 'playwright-core'
import { decrypt, loadKey } from './crypto.js'
import { sendAlert } from './alert.js'

chromium.use(stealth())

const SCRAPER_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRAPER_DIR, '..')
dotenv.config({ path: path.join(SCRAPER_DIR, '.env') })

export type DetectionReason =
  | 'session_expired'
  | 'captcha_detected'
  | '2fa_challenge'
  | 'blocked'
  | 'parse_failure'

export interface NormalizedBooking {
  ota: string
  property: string | null
  confirmationCode: string | null
  guestName: string | null
  checkIn: string | null
  checkOut: string | null
  status: string | null
  raw: unknown
}

interface ExtranetTarget {
  ota: string
  /** Cookie file inside scraper/ holding the encrypted session. */
  cookieFile: string
  /** Entry point — the reservations list for single-property accounts. */
  reservationsUrl: string
  /** URL path fragments that mean the session was rejected. */
  loginPathPatterns: RegExp[]
  /** DOM wait that proves we reached a real reservations page. */
  reservationsReadySelector: string
  extractBookings(page: Page): Promise<NormalizedBooking[]>
}

/**
 * Booking.com extranet adapter.
 *
 * Assumptions (to be validated/refined with a real session):
 *  - A valid `ses` cookie on .booking.com keeps admin.booking.com logged in;
 *    an expired/invalid one redirects to /hotel/single-sign-on or admin
 *    login pages.
 *  - The reservations list lives under /hotel/hoteladmin/extranet_ng/manage/booking/...
 *    with reservation rows exposing data like booker name, check-in/check-out
 *    dates and a reservation number. We probe several selector candidates and
 *    treat "none of them found" as parse_failure rather than an empty list.
 */
const BOOKING_ADAPTER: ExtranetTarget = {
  ota: 'booking_com',
  cookieFile: 'cookies.booking.enc',
  reservationsUrl:
    'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking/reservations/index.html?lang=en',
  loginPathPatterns: [
    /\/hotel\/single-sign-on/i,
    /\/login/i,
    /\/signin/i,
    /\/sign-in/i,
    /\/auth/i,
  ],
  reservationsReadySelector:
    '[data-bui-ref*="reservation" i], [class*="reservation" i], [id*="reservation" i], table',
  async extractBookings(page) {
    // Candidate row containers for the reservations table/list. The extranet
    // has shipped several layouts (old table, "extranet_ng" card list), so we
    // try each in order and require a non-empty result.
    const rowSelectors = [
      '[data-bui-ref*="reservation-item" i]',
      '[class*="reservation-item" i]',
      'tr[class*="reservation" i]',
      'table tbody tr',
    ]

    let rows: Awaited<ReturnType<Page['$$']>> = []
    for (const sel of rowSelectors) {
      rows = await page.$$(sel)
      if (rows.length > 0) break
    }
    if (rows.length === 0) return []

    const bookings: NormalizedBooking[] = []
    for (const row of rows) {
      // Heuristic field extraction; each helper tries several child selectors.
      const pick = async (selectors: string[]): Promise<string | null> => {
        for (const sel of selectors) {
          const el = await row.$(sel)
          const text = el ? (await el.textContent())?.trim() : null
          if (text) return text
        }
        return null
      }
      const confirmationCode = await pick([
        '[class*="reservation-number" i]',
        '[data-bui-ref*="reservation-number" i]',
        'td:nth-of-type(1)',
      ])
      const guestName = await pick([
        '[class*="booker" i]',
        '[class*="guest" i]',
        'td:nth-of-type(2)',
      ])
      const checkIn = await pick(['[class*="check-in" i]', 'td:nth-of-type(3)'])
      const checkOut = await pick(['[class*="check-out" i]', 'td:nth-of-type(4)'])
      const status = await pick(['[class*="status" i]', 'td:nth-of-type(5)'])
      const raw = (await row.textContent())?.trim() ?? null

      // A row with nothing recognizable is layout noise, not a booking.
      if (!confirmationCode && !guestName) continue

      bookings.push({
        ota: this.ota,
        property: process.env.BOOKING_PROPERTY_NAME ?? null,
        confirmationCode,
        guestName,
        checkIn,
        checkOut,
        status,
        raw,
      })
    }
    return bookings
  },
}

const TARGETS: Record<string, ExtranetTarget> = {
  booking_com: BOOKING_ADAPTER,
}

const CAPTCHA_IFRAME_RE = /recaptcha|hcaptcha|arkoselabs|funcaptcha/i
const CAPTCHA_TEXT_RE =
  /verify you are human|are you a robot|unusual traffic|security check|press & hold/i
const TWOFA_INPUT_SEL =
  'input[name*="otp" i], input[name*="verification" i], input[name*="pin" i], input[autocomplete="one-time-code"]'
const TWOFA_TEXT_RE = /two[- ]factor|verification code|enter the (pin|code)|security code/i

async function detect(page: Page, response: Response | null): Promise<DetectionReason | null> {
  // 1. Hard HTTP block on the main navigation.
  if (response) {
    const status = response.status()
    if (status === 403 || status === 429) return 'blocked'
  }

  // 2. Redirected to a login/signin/auth page → session no longer valid.
  const url = page.url()
  for (const target of Object.values(TARGETS)) {
    if (target.loginPathPatterns.some((re) => re.test(url))) return 'session_expired'
  }

  // 3. Captcha: known captcha iframes or challenge copy on the page.
  const frames = page.frames()
  if (frames.some((f) => CAPTCHA_IFRAME_RE.test(f.url()))) return 'captcha_detected'
  const captchaIframe = await page.$(
    'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="arkoselabs" i]',
  )
  if (captchaIframe) return 'captcha_detected'

  const bodyText = ((await page.textContent('body').catch(() => '')) ?? '').slice(0, 20000)
  if (CAPTCHA_TEXT_RE.test(bodyText)) return 'captcha_detected'

  // 4. 2FA: verification-code inputs or challenge copy.
  if (await page.$(TWOFA_INPUT_SEL)) return '2fa_challenge'
  if (TWOFA_TEXT_RE.test(bodyText)) return '2fa_challenge'

  return null
}

async function fail(
  target: ExtranetTarget,
  reason: DetectionReason,
  url: string,
): Promise<never> {
  console.error(`DETECTED: ${reason} at ${url}`)
  try {
    await sendAlert({ ota: target.ota, reason, url })
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(3) // the alert itself failed — make noise via exit code
  }
  process.exit(2)
}

async function main() {
  const targetName = process.argv[2] ?? 'booking_com'
  const target = TARGETS[targetName]
  if (!target) {
    console.error(`Unknown OTA target "${targetName}". Known: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(1)
  }

  // --- Load + decrypt session cookies -------------------------------------
  const cookiePath = path.join(SCRAPER_DIR, target.cookieFile)
  let cookies: unknown[]
  try {
    const blob = JSON.parse(await readFile(cookiePath, 'utf8'))
    cookies = JSON.parse(decrypt(blob, loadKey()))
  } catch (err) {
    console.error(
      `Could not load/decrypt ${cookiePath}: ${err instanceof Error ? err.message : err}`,
    )
    process.exit(1)
  }

  // --- Launch stealth Chromium --------------------------------------------
  const browser = await chromium.launch({ headless: true })
  let lastUrl = target.reservationsUrl
  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1440, height: 900 },
    })
    await context.addCookies(cookies as Parameters<typeof context.addCookies>[0])
    const page = await context.newPage()

    const response = await page.goto(target.reservationsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    lastUrl = page.url()
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

    // --- Detection gate -----------------------------------------------------
    const reason = await detect(page, response)
    if (reason) await fail(target, reason, lastUrl)

    // --- Parse reservations --------------------------------------------------
    const ready = await page
      .waitForSelector(target.reservationsReadySelector, { timeout: 15_000 })
      .catch(() => null)
    if (!ready) {
      await fail(target, 'parse_failure', lastUrl)
    }

    const bookings = await target.extractBookings(page)
    if (bookings.length === 0) {
      // Structure not recognized — detection, not a silent empty result.
      await fail(target, 'parse_failure', lastUrl)
    }

    await mkdir(path.join(REPO_ROOT, 'artifacts'), { recursive: true })
    const outPath = path.join(REPO_ROOT, 'artifacts', 'extranet-bookings.json')
    await writeFile(
      outPath,
      JSON.stringify({ ota: target.ota, syncedAt: new Date().toISOString(), bookings }, null, 2),
    )
    console.log(`OK — ${bookings.length} bookings written to ${outPath}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
