#!/usr/bin/env node
/**
 * server/verify-kiosk.mjs — end-to-end verification of the /kiosk flow.
 *
 * Prereqs: `npm run dev` on :5173 and the API server on :3001 (both running).
 *
 * 1. Creates a "KIOSK TEST GUEST" booking due TODAY via pg.
 * 2. Drives /kiosk?idleTimeoutSec=5 in headless Chromium with a fake camera:
 *    Welcome -> lookup -> confirm -> capture photo -> draw signature -> Done.
 * 3. Asserts DB: bookings.status='checked_in' + a check_ins row with images.
 * 4. Waits past the idle timeout from Done: asserts Welcome screen, empty
 *    localStorage/sessionStorage, no cookies; asserts the booking no longer
 *    shows up in lookup and a repeat checkin returns 409 already_checked_in.
 * 5. Cleans up the test rows. Screenshots in artifacts/.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'
const GUEST_NAME = 'KIOSK TEST GUEST'

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

await mkdir('artifacts', { recursive: true })

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function cleanup() {
  await client.query(
    `delete from check_ins where booking_id in
       (select id from bookings where guest_id in (select id from guests where full_name = $1))`,
    [GUEST_NAME],
  )
  await client.query(
    'delete from bookings where guest_id in (select id from guests where full_name = $1)',
    [GUEST_NAME],
  )
  await client.query('delete from guests where full_name = $1', [GUEST_NAME])
}

let exitCode = 0
try {
  await client.connect()
  await cleanup() // in case a previous run left debris

  // --- seed a booking due today ---
  const bed = (
    await client.query(
      `select b.id from beds b
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD' and b.status = 'active'
          and not exists (
                select 1 from booking_beds bb
                 where bb.bed_id = b.id and bb.is_active
                   and bb.stay && daterange(current_date, current_date + 2))
        order by r.name, b.label limit 1`,
    )
  ).rows[0]
  if (!bed) throw new Error('no free active bed for the kiosk test booking')
  const guestId = (
    await client.query('insert into guests (full_name) values ($1) returning id', [GUEST_NAME])
  ).rows[0].id
  const bookingId = (
    await client.query(
      "insert into bookings (guest_id, source) values ($1, 'direct') returning id",
      [guestId],
    )
  ).rows[0].id
  await client.query(
    'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange(current_date, current_date + 2))',
    [bookingId, bed.id],
  )
  console.log(`seeded booking ${bookingId.slice(0, 8)} due today for "${GUEST_NAME}"`)

  // --- drive the kiosk UI ---
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  const context = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    permissions: ['camera'],
  })
  const page = await context.newPage()

  try {
    await page.goto(`${APP_URL}/kiosk?idleTimeoutSec=5`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Touch to check in' }).waitFor()
    check('k1: welcome screen renders', true)
    await page.screenshot({ path: 'artifacts/kiosk-welcome.png' })

    await page.getByRole('button', { name: 'Touch to check in' }).click()
    await page.getByPlaceholder('Name or reference').fill('KIOSK TEST')
    await page.getByRole('button', { name: 'Find my booking' }).click()
    await page.getByRole('button', { name: new RegExp(GUEST_NAME) }).waitFor()
    check('k2: lookup finds the test booking', true)

    await page.getByRole('button', { name: new RegExp(GUEST_NAME) }).click()
    await page.getByRole('heading', { name: 'Confirm your stay' }).waitFor()
    await page.getByRole('button', { name: "Yes, that's me" }).click()

    await page.getByRole('button', { name: 'Capture' }).waitFor()
    // let the fake camera stream deliver a few frames before capturing
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'artifacts/kiosk-photo.png' })
    await page.getByRole('button', { name: 'Capture' }).click()
    await page.getByRole('button', { name: 'Use photo' }).waitFor()
    check('k3: photo captured from fake camera', true)
    await page.getByRole('button', { name: 'Use photo' }).click()

    // draw a signature: two strokes across the canvas
    await page.locator('canvas').waitFor()
    const box = await page.locator('canvas').boundingBox()
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    for (let x = 40; x <= box.width - 40; x += 12) {
      await page.mouse.move(box.x + x, box.y + box.height / 2 + Math.sin(x / 18) * 40)
    }
    await page.mouse.up()
    await page.mouse.move(box.x + 60, box.y + box.height - 40)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 60, box.y + box.height - 60)
    await page.mouse.up()
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByRole('heading', { name: /You're checked in/ }).waitFor({ timeout: 15000 })
    const doneText = await page.locator('main').textContent()
    check('k4: done screen shows room and bed', /· Bed [A-Z]/.test(doneText), doneText.match(/· Bed \w/)?.[0])
    await page.screenshot({ path: 'artifacts/kiosk-done.png' })

    // --- DB assertions ---
    const status = (
      await client.query('select status from bookings where id = $1', [bookingId])
    ).rows[0].status
    check('k5: bookings.status = checked_in', status === 'checked_in', `got ${status}`)
    const checkInRow = (
      await client.query(
        'select length(id_image) as id_len, length(signature_image) as sig_len from check_ins where booking_id = $1',
        [bookingId],
      )
    ).rows[0]
    check(
      'k6: check_ins row exists with both images',
      Boolean(checkInRow) && checkInRow.id_len > 1000 && checkInRow.sig_len > 100,
      checkInRow ? `id_image ${checkInRow.id_len} chars, signature ${checkInRow.sig_len} chars` : 'missing',
    )

    // --- persistence / idle-timeout check (idleTimeoutSec=5; Done resets after 5s) ---
    await page.getByRole('button', { name: 'Touch to check in' }).waitFor({ timeout: 10000 })
    check('k7: UI auto-reset to Welcome after idle timeout', true)
    const storage = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    }))
    check(
      'k8: no persisted guest data (storage + cookies empty)',
      storage.local === 0 && storage.session === 0 && storage.cookies === '',
      JSON.stringify(storage),
    )

    // --- booking no longer checkable ---
    const lookupAgain = await (
      await fetch(`${API}/api/kiosk/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'KIOSK TEST' }),
      })
    ).json()
    check(
      'k9: lookup no longer returns the checked-in booking',
      Array.isArray(lookupAgain.results) && lookupAgain.results.length === 0,
    )
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const again = await fetch(`${API}/api/kiosk/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, idPhoto: tinyPng, signature: tinyPng }),
    })
    const againBody = await again.json()
    check(
      'k10: repeat checkin returns 409 already_checked_in',
      again.status === 409 && againBody.error === 'already_checked_in',
      `got ${again.status} ${JSON.stringify(againBody)}`,
    )
  } catch (err) {
    check('kiosk flow completed without errors', false, String(err).split('\n')[0])
    await page.screenshot({ path: 'artifacts/kiosk-error.png' }).catch(() => {})
  } finally {
    await browser.close()
  }
} finally {
  await cleanup().catch(() => {})
  await client.end().catch(() => {})
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
exitCode = failed.length === 0 ? 0 : 1
process.exit(exitCode)
