#!/usr/bin/env node
/**
 * server/verify-housekeeping.mjs — verifies the housekeeping module:
 *
 * API part (pg + fetch against :3001):
 *  1. Pick a seeded free bed with a free window (today+20..+23).
 *  2. GET /api/availability includes it -> PATCH out_of_order -> excluded.
 *  3. POST /api/bookings for that room/range must NOT assign it.
 *  4. Direct pg insert into booking_beds for the OOO bed must fail (trigger).
 *  5. PATCH dirty -> availability includes it again (dirty doesn't block).
 *  6. PATCH back to clean.
 * UI part (Playwright, iPhone viewport 390x844):
 *  7. /housekeeping renders the bed list; setting a bed to "Out of order" via
 *     the dropdown is reflected by the API; restored afterwards.
 *  Screenshot: artifacts/housekeeping.png
 */
import { mkdir } from 'node:fs/promises'
import { config as loadEnv } from 'dotenv'
import { chromium, devices } from 'playwright'
import pg from 'pg'

loadEnv({ path: 'server/.env', quiet: true })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL must be set (server/.env)')
  process.exit(1)
}
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const GUEST_NAME = 'HK TEST GUEST'

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const patch = (bedId, housekeepingStatus) =>
  fetch(`${API}/api/housekeeping/beds/${bedId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ housekeepingStatus }),
  })

const availability = async (checkIn, checkOut) =>
  (
    await (
      await fetch(
        `${API}/api/availability?propertyCode=ADD&checkIn=${checkIn}&checkOut=${checkOut}`,
      )
    ).json()
  ).beds

async function cleanup() {
  await client.query(
    'delete from bookings where guest_id in (select id from guests where full_name = $1)',
    [GUEST_NAME],
  )
  await client.query('delete from guests where full_name = $1', [GUEST_NAME])
}

try {
  await mkdir('artifacts', { recursive: true })
  await client.connect()
  await cleanup()

  const checkIn = day(20)
  const checkOut = day(23)

  // a seeded, active, clean bed with no bookings in the test window
  const bed = (
    await client.query(
      `select b.id, r.room_type
         from beds b
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD' and b.status = 'active' and b.housekeeping_status = 'clean'
          and not exists (
                select 1 from booking_beds bb
                 where bb.bed_id = b.id and bb.is_active
                   and bb.stay && daterange($1, $2))
        order by r.name, b.label limit 1`,
      [checkIn, checkOut],
    )
  ).rows[0]
  if (!bed) throw new Error('no free clean bed found for the test window')

  // --- 2: availability includes it; OOO excludes it ---
  const before = await availability(checkIn, checkOut)
  check('h1: availability includes the clean bed', before.some((b) => b.bedId === bed.id))

  const patchRes = await patch(bed.id, 'out_of_order')
  const patched = await patchRes.json()
  check(
    'h2: PATCH returns 200 with updated bed shape',
    patchRes.status === 200 && patched.housekeepingStatus === 'out_of_order' && typeof patched.occupied === 'boolean',
    `status=${patchRes.status}`,
  )

  const after = await availability(checkIn, checkOut)
  check('h3: availability excludes the out-of-order bed', !after.some((b) => b.bedId === bed.id))

  // --- 3: POST /api/bookings must not assign the OOO bed ---
  const bookingRes = await fetch(`${API}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyCode: 'ADD',
      roomType: bed.room_type,
      checkIn,
      checkOut,
      guest: { fullName: GUEST_NAME },
    }),
  })
  const bookingBody = await bookingRes.json()
  check(
    'h4: POST /api/bookings assigns a different bed (or 409s)',
    bookingRes.status === 201 ? bookingBody.bedId !== bed.id : bookingRes.status === 409,
    `status=${bookingRes.status} bedId=${bookingBody.bedId ?? '-'}`,
  )

  // --- 4: the DB trigger rejects a direct insert on the OOO bed ---
  const guestId = (
    await client.query('insert into guests (full_name) values ($1) returning id', [GUEST_NAME])
  ).rows[0].id
  const triggerBookingId = (
    await client.query("insert into bookings (guest_id, source) values ($1, 'direct') returning id", [guestId])
  ).rows[0].id
  let triggerError = null
  try {
    await client.query(
      'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))',
      [triggerBookingId, bed.id, checkIn, checkOut],
    )
  } catch (err) {
    triggerError = err
  }
  check(
    'h5: direct booking_beds insert on OOO bed fails (trigger)',
    triggerError !== null && /out of order/i.test(triggerError.message),
    triggerError ? `${triggerError.code}: ${triggerError.message.split('\n')[0]}` : 'no error raised',
  )

  // --- 5: dirty does NOT block availability ---
  await patch(bed.id, 'dirty')
  const dirtyAvail = await availability(checkIn, checkOut)
  check('h6: dirty bed is back in availability (only OOO blocks)', dirtyAvail.some((b) => b.bedId === bed.id))

  // --- 6: restore ---
  await patch(bed.id, 'clean')

  // --- 7: UI at iPhone viewport ---
  const browser = await chromium.launch()
  const page = await browser.newPage({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  try {
    await page.goto(`${APP_URL}/housekeeping`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Housekeeping' }).waitFor()
    await page.locator('select[aria-label^="Housekeeping status"]').first().waitFor()
    check('h7: /housekeeping renders the bed list on a phone viewport', true)

    const select = page.locator('select[aria-label^="Housekeeping status"]').first()
    const bedLabel = await select.getAttribute('aria-label')
    await select.selectOption({ label: 'Out of order' })
    await page.waitForTimeout(800) // optimistic update + PATCH round-trip

    const hkBeds = (
      await (await fetch(`${API}/api/housekeeping/beds?propertyCode=ADD`)).json()
    ).beds
    const oooBeds = hkBeds.filter((b) => b.housekeepingStatus === 'out_of_order')
    check(
      'h8: UI dropdown change reflected by the API',
      oooBeds.length >= 1,
      `${oooBeds.length} OOO bed(s) after UI change (${bedLabel})`,
    )
    await page.screenshot({ path: 'artifacts/housekeeping.png', fullPage: true })
    console.log('screenshot: artifacts/housekeeping.png')

    // restore via the UI as well
    await select.selectOption({ label: 'Clean' })
    await page.waitForTimeout(800)
    const restored = (
      await (await fetch(`${API}/api/housekeeping/beds?propertyCode=ADD`)).json()
    ).beds
    check(
      'h9: bed restored to clean via the UI',
      restored.every((b) => b.housekeepingStatus !== 'out_of_order'),
    )
  } catch (err) {
    check('h7-h9: housekeeping UI flow', false, String(err).split('\n')[0])
    await page.screenshot({ path: 'artifacts/housekeeping.png', fullPage: true }).catch(() => {})
  } finally {
    await browser.close()
  }
} finally {
  await cleanup().catch(() => {})
  await client.end().catch(() => {})
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
