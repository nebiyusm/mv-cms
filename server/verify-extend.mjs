#!/usr/bin/env node
/**
 * server/verify-extend.mjs — end-to-end verification of the kiosk
 * "extend my stay" flow with real Stripe TEST-mode payment.
 *
 * Prereqs: `npm run dev` on :5173 and the API server on :3001 (both running),
 * server/.env with DATABASE_URL / STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.
 *
 * 1. Seeds an in-house guest ("EXTEND TEST GUEST", checked_in, out tomorrow,
 *    bed free >= 3 nights after checkout, room rate 20.00).
 * 2. API: quote (maxNights >= 3) and checkout for 2 nights (real Stripe URL).
 * 3. Pays the Stripe Checkout page in headless Chromium (card 4242…).
 * 4. Stripe can't reach localhost, so the script retrieves the session from
 *    the Stripe API and POSTs a SELF-SIGNED checkout.session.completed
 *    webhook to /api/webhooks/stripe.
 * 5. pg asserts: stay extended +2, folio + extension (+40.00) / payment
 *    (-40.00) line items keyed by session id; replayed webhook is a no-op.
 * 6. UI: drives /kiosk extend flow to the QR screen; screenshot.
 * 7. Cleans up all test rows.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { config as loadEnv } from 'dotenv'
import { chromium } from 'playwright'
import pg from 'pg'

loadEnv({ path: 'server/.env', quiet: true })

const DATABASE_URL = process.env.DATABASE_URL
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
if (!DATABASE_URL || !STRIPE_KEY || !WEBHOOK_SECRET) {
  console.error('DATABASE_URL, STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set (server/.env)')
  process.exit(1)
}
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const GUEST_NAME = 'EXTEND TEST GUEST'

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function cleanup() {
  await client.query(
    `delete from folios where booking_id in
       (select id from bookings where guest_id in (select id from guests where full_name = $1))`,
    [GUEST_NAME],
  )
  await client.query(
    'delete from bookings where guest_id in (select id from guests where full_name = $1)',
    [GUEST_NAME],
  )
  await client.query('delete from guests where full_name = $1', [GUEST_NAME])
}

/** Build a self-signed checkout.session.completed webhook request. */
function signedWebhook(session) {
  const payload = JSON.stringify({
    id: `evt_localdev_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  })
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')
  return fetch(`${API}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${t},v1=${v1}`,
    },
    body: payload,
  })
}

let bookingId = ''
try {
  await client.connect()
  await cleanup()

  // --- seed: in-house guest, checks out tomorrow, bed free >= 3 nights after ---
  const bed = (
    await client.query(
      `select b.id as bed_id, r.id as room_id
         from beds b
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD' and b.status = 'active'
          and not exists (
                select 1 from booking_beds bb
                 where bb.bed_id = b.id and bb.is_active
                   and bb.stay && daterange(current_date - 1, current_date + 10))
        order by r.name, b.label limit 1`,
    )
  ).rows[0]
  if (!bed) throw new Error('no bed free for the whole test window')
  await client.query('update rooms set nightly_rate = 20.00 where id = $1', [bed.room_id])
  const guestId = (
    await client.query('insert into guests (full_name) values ($1) returning id', [GUEST_NAME])
  ).rows[0].id
  bookingId = (
    await client.query(
      "insert into bookings (guest_id, source, status) values ($1, 'direct', 'checked_in') returning id",
      [guestId],
    )
  ).rows[0].id
  await client.query(
    'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange(current_date - 1, current_date + 1))',
    [bookingId, bed.bed_id],
  )
  // Read the seeded check-out back from the DB (its clock can differ from local).
  const upperBefore = (
    await client.query(
      'select upper(stay)::text as u from booking_beds where booking_id = $1 and is_active',
      [bookingId],
    )
  ).rows[0].u
  const expectedUpper = addDays(upperBefore, 2)
  console.log(`seeded in-house booking ${bookingId.slice(0, 8)} (checks out ${upperBefore})`)

  // --- API: quote ---
  const quoteRes = await post('/api/kiosk/extend/quote', { query: 'EXTEND TEST' })
  const quote = await quoteRes.json()
  const match = quote.results?.[0]
  check('e1: quote returns 200 with the in-house guest', quoteRes.status === 200 && !!match)
  check(
    'e2: quote has maxNights >= 3 and rate 20',
    match && match.maxNights >= 3 && match.nightlyRate === 20 && match.currency === 'USD',
    match ? `maxNights=${match.maxNights} rate=${match.nightlyRate}` : 'no match',
  )

  // --- API: checkout ---
  const coRes = await post('/api/kiosk/extend/checkout', { bookingId, nights: 2 })
  const co = await coRes.json()
  check(
    'e3: checkout returns 201 with a real Stripe URL',
    coRes.status === 201 && typeof co.checkoutUrl === 'string' && co.checkoutUrl.startsWith('https://checkout.stripe.com'),
    `status=${coRes.status} amount=${co.amount}`,
  )
  check('e4: amount = 2 x 20 = 40 USD', co.amount === 40 && co.currency === 'USD')
  const sessionId = co.sessionId

  // --- pay the Stripe Checkout page ---
  const browser = await chromium.launch()
  const payPage = await browser.newPage()
  try {
    await payPage.goto(co.checkoutUrl, { waitUntil: 'domcontentloaded' })
    await payPage.locator('input#email').pressSequentially('extend-test@example.com', { delay: 15 })
    // Card fields live in the top-level document on the hosted checkout page.
    await payPage.locator('#cardNumber').pressSequentially('4242424242424242', { delay: 15 })
    await payPage.locator('#cardExpiry').pressSequentially('1234', { delay: 15 })
    await payPage.locator('#cardCvc').pressSequentially('123', { delay: 15 })
    const billingName = payPage.locator('#billingName')
    if (await billingName.isVisible().catch(() => false)) await billingName.fill('Extend Test')
    const zip = payPage.locator('#Field-postalCodeInput, #billingPostalCode')
    if (await zip.first().isVisible().catch(() => false)) await zip.first().fill('10001')
    await payPage.locator('button[type="submit"]').first().click()
    await payPage.waitForURL(/\/kiosk\?paid=1/, { timeout: 60000 })
    check('e5: Stripe test payment completed (redirected to success URL)', true)
  } catch (err) {
    check('e5: Stripe test payment completed (redirected to success URL)', false, String(err).split('\n')[0])
    await payPage.screenshot({ path: 'artifacts/extend-stripe-error.png' }).catch(() => {})
  }
  await browser.close()

  // --- retrieve the session and self-deliver the webhook ---
  const session = await (
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    })
  ).json()
  check(
    'e6: Stripe session is paid',
    session.payment_status === 'paid',
    `payment_status=${session.payment_status}`,
  )

  const hook1 = await signedWebhook(session)
  check('e7: self-signed webhook accepted (200)', hook1.status === 200, `got ${hook1.status}`)

  // --- DB assertions ---
  const newUpper = (
    await client.query(
      'select upper(stay)::text as u from booking_beds where booking_id = $1 and is_active',
      [bookingId],
    )
  ).rows[0].u
  check('e8: stay extended by 2 nights', newUpper === expectedUpper, `new check-out ${newUpper} (expected ${expectedUpper})`)

  const folio = (
    await client.query('select id from folios where booking_id = $1', [bookingId])
  ).rows[0]
  check('e9: folio exists for the booking', Boolean(folio))

  const items = (
    await client.query(
      'select type, amount::float8 as amount, external_ref from folio_line_items where folio_id = $1 order by type',
      [folio?.id ?? '00000000-0000-0000-0000-000000000000'],
    )
  ).rows
  const ext = items.find((i) => i.type === 'extension')
  const pay = items.find((i) => i.type === 'payment')
  check(
    'e10: extension charge +40.00 with session id as external_ref',
    ext?.amount === 40 && ext?.external_ref === sessionId,
    JSON.stringify(ext ?? null),
  )
  check(
    'e11: payment line -40.00 with session id:payment',
    pay?.amount === -40 && pay?.external_ref === `${sessionId}:payment`,
    JSON.stringify(pay ?? null),
  )

  const hook2 = await signedWebhook(session)
  const itemsAfter = (
    await client.query('select count(*)::int as n from folio_line_items where folio_id = $1', [folio?.id ?? ''])
  ).rows[0].n
  check(
    'e12: replayed webhook is idempotent (200, still 2 line items)',
    hook2.status === 200 && itemsAfter === 2,
    `status=${hook2.status} items=${itemsAfter}`,
  )

  // --- status endpoint reflects payment ---
  const statusRes = await fetch(`${API}/api/kiosk/extend/status?sessionId=${sessionId}`)
  const statusBody = await statusRes.json()
  check('e13: extend/status reports paid', statusBody.status === 'paid')

  // --- UI flow to the QR screen ---
  const uiBrowser = await chromium.launch()
  const page = await uiBrowser.newPage({ viewport: { width: 900, height: 1000 } })
  try {
    await page.goto(`${APP_URL}/kiosk?idleTimeoutSec=60`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Extend my stay' }).click()
    await page.getByPlaceholder('Name or reference').fill('EXTEND TEST')
    await page.getByRole('button', { name: 'Find my booking' }).click()
    await page.getByRole('button', { name: new RegExp(GUEST_NAME) }).click()
    await page.getByRole('heading', { name: 'Extend your stay' }).waitFor()
    await page.getByRole('button', { name: 'One more night' }).click()
    const payLabel = await page.getByRole('button', { name: /^Pay \$/ }).textContent()
    check('e14: summary stepper shows live total ($40 for 2 nights)', payLabel?.includes('40.00'), payLabel?.trim())
    await page.getByRole('button', { name: /^Pay \$/ }).click()
    await page.getByRole('heading', { name: 'Scan with your phone to pay' }).waitFor({ timeout: 15000 })
    const qrVisible = await page.locator('svg').last().isVisible()
    check('e15: QR code + amount shown on pay screen', qrVisible)
    await page.screenshot({ path: 'artifacts/kiosk-extend.png' })
    console.log('screenshot: artifacts/kiosk-extend.png')
  } catch (err) {
    check('e14/e15: kiosk extend UI flow', false, String(err).split('\n')[0])
    await page.screenshot({ path: 'artifacts/kiosk-extend.png' }).catch(() => {})
  } finally {
    await uiBrowser.close()
  }
} finally {
  await cleanup().catch(() => {})
  await client.end().catch(() => {})
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
