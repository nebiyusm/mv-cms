#!/usr/bin/env node
/**
 * server/verify-admin.mjs — verifies the /admin analytics API + dashboard.
 *
 * Prereqs: API server on :3001 and Vite on :5173 running; server/.env present.
 *
 * 1. Runs seed.mjs then seed-analytics.mjs (dense deterministic history).
 * 2. Independent expected-metrics calculation straight from pg (per-bed-per-day
 *    counting), compared against GET /api/admin/stats: totals occupancy/revenue
 *    (±0.01) and 3 spot-checked daily rows (occupied bed-nights, occupancy %,
 *    revenue).
 * 3. Channels counts sum = bookings overlapping the range; per-source counts
 *    match a direct pg GROUP BY.
 * 4. Playwright: /admin renders non-zero stat cards and three chart SVGs;
 *    screenshot artifacts/admin.png.
 * 5. Cleanup: analytics rows deleted, seed.mjs re-run.
 *
 * All date math anchors on the DB's current_date.
 */
import { execSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { config as loadEnv } from 'dotenv'
import { chromium } from 'playwright'
import pg from 'pg'

loadEnv({ path: 'server/.env', quiet: true })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL must be set (server/.env)')
  process.exit(1)
}
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const round2 = (n) => Math.round(n * 100) / 100
const close = (a, b, eps = 0.011) => Math.abs(a - b) < eps

async function cleanupAnalytics() {
  await client.query(
    `delete from bookings where guest_id in
       (select id from guests where full_name like 'ANX GUEST %')`,
  )
  await client.query("delete from guests where full_name like 'ANX GUEST %'")
}

try {
  await mkdir('artifacts', { recursive: true })

  console.log('running seed.mjs …')
  execSync('node server/seed.mjs', { stdio: 'pipe' })
  console.log('running seed-analytics.mjs …')
  const seedOut = execSync('node server/seed-analytics.mjs').toString().trim()
  console.log(seedOut)

  await client.connect()
  const { rows: [{ today }] } = await client.query('select current_date::text as today')
  const from = addDays(today, -14)
  const to = today // [) — 14 days ending yesterday
  console.log(`DB today: ${today}, range: ${from} -> ${to}`)

  /* ---------- independent expected calculation (per-bed-per-day) ---------- */
  const available = (
    await client.query(
      `select count(*)::int as n
         from beds b join rooms r on r.id = b.room_id join properties p on p.id = r.property_id
        where p.code = 'ADD' and b.status = 'active'`,
    )
  ).rows[0].n

  const expectedDaily = []
  for (let i = 0; i < 14; i++) {
    const day = addDays(from, i)
    const row = (
      await client.query(
        `select count(*)::int as occ, coalesce(sum(r.nightly_rate), 0)::float8 as revenue
           from booking_beds bb
           join beds b on b.id = bb.bed_id
           join rooms r on r.id = b.room_id
           join properties p on p.id = r.property_id
          where bb.is_active and p.code = 'ADD' and bb.stay @> $1::date`,
        [day],
      )
    ).rows[0]
    expectedDaily.push({ date: day, occ: row.occ, revenue: row.revenue })
  }
  const expectedOcc = expectedDaily.reduce((s, d) => s + d.occ, 0)
  const expectedAvail = available * 14
  const expectedRevenue = round2(expectedDaily.reduce((s, d) => s + d.revenue, 0))
  const expectedOccPct = round2((100 * expectedOcc) / expectedAvail)

  /* ------------------------------ API response ----------------------------- */
  const res = await fetch(`${API}/api/admin/stats?propertyCode=ADD&from=${from}&to=${to}`)
  const stats = await res.json()
  check('v1: stats returns 200', res.status === 200, `got ${res.status}`)

  check(
    'v2: totals.occupancyPct matches manual calc',
    close(stats.totals.occupancyPct, expectedOccPct),
    `api=${stats.totals.occupancyPct} expected=${expectedOccPct} (${expectedOcc}/${expectedAvail} bed-nights)`,
  )
  check(
    'v3: totals.revenue matches manual calc',
    close(stats.totals.revenue, expectedRevenue),
    `api=${stats.totals.revenue} expected=${expectedRevenue}`,
  )
  check(
    'v4: totals bed-night counts match',
    stats.totals.occupiedBedNights === expectedOcc && stats.totals.availableBedNights === expectedAvail,
    `api=${stats.totals.occupiedBedNights}/${stats.totals.availableBedNights} expected=${expectedOcc}/${expectedAvail}`,
  )

  for (const idx of [0, 7, 13]) {
    const exp = expectedDaily[idx]
    const got = stats.daily[idx]
    const expPct = round2((100 * exp.occ) / available)
    check(
      `v5.${idx}: daily row ${exp.date} matches (occupied, occupancyPct, revenue)`,
      got.date === exp.date &&
        got.occupiedBedNights === exp.occ &&
        close(got.occupancyPct, expPct) &&
        close(got.revenue, round2(exp.revenue)),
      `api=${got.occupiedBedNights}/${got.occupancyPct}%/$${got.revenue} expected=${exp.occ}/${expPct}%/$${round2(exp.revenue)}`,
    )
  }

  /* -------------------------------- channels ------------------------------- */
  const overlapping = (
    await client.query(
      `select count(distinct bk.id)::int as n
         from bookings bk
         join booking_beds bb on bb.booking_id = bk.id and bb.is_active
         join beds b on b.id = bb.bed_id
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD' and bb.stay && daterange($1, $2)`,
      [from, to],
    )
  ).rows[0].n
  const channelSum = stats.channels.reduce((s, c) => s + c.bookings, 0)
  check(
    'v6: channel counts sum = bookings overlapping the range',
    channelSum === overlapping,
    `api channels sum=${channelSum} pg=${overlapping}`,
  )

  const perSource = Object.fromEntries(
    (
      await client.query(
        `select bk.source, count(distinct bk.id)::int as n
           from bookings bk
           join booking_beds bb on bb.booking_id = bk.id and bb.is_active
           join beds b on b.id = bb.bed_id
           join rooms r on r.id = b.room_id
           join properties p on p.id = r.property_id
          where p.code = 'ADD' and bb.stay && daterange($1, $2)
          group by bk.source`,
        [from, to],
      )
    ).rows.map((r) => [r.source, r.n]),
  )
  check(
    'v7: per-source channel counts match pg GROUP BY',
    stats.channels.every((c) => perSource[c.source] === c.bookings),
    JSON.stringify(stats.channels.map((c) => `${c.source}:${c.bookings}`)),
  )

  /* ------------------------------ validation ------------------------------- */
  const bad = await fetch(`${API}/api/admin/stats?propertyCode=ADD&from=${to}&to=${from}`)
  check('v8: inverted range returns 400', bad.status === 400, `got ${bad.status}`)

  /* --------------------------------- UI ------------------------------------ */
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  try {
    await page.goto(`${APP_URL}/admin`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Reports' }).waitFor()
    await page.getByText('Bookings in range').waitFor()

    const cardValue = async (label) => {
      const card = page.locator('div.rounded-lg', { has: page.getByText(label, { exact: true }) }).first()
      return card.locator('.text-4xl').first().textContent()
    }
    const occupancy = await cardValue('Occupancy (today)')
    const adr = await cardValue('ADR (range)')
    const revpar = await cardValue('RevPAR (range)')
    const bookings = await cardValue('Bookings in range')
    check(
      'v9: stat cards render non-zero values',
      occupancy !== '0%' && adr !== '$0.00' && revpar !== '$0.00' && Number(bookings) > 0,
      `occ=${occupancy} adr=${adr} revpar=${revpar} bookings=${bookings}`,
    )

    const svgCount = await page.locator('svg.recharts-surface').count()
    check('v10: three charts render SVG content', svgCount >= 3, `${svgCount} chart SVGs`)

    await page.getByText('Daily breakdown').waitFor()
    const tableRows = await page.locator('tbody tr').count()
    check('v11: daily breakdown table has rows', tableRows >= 14, `${tableRows} rows`)

    await page.screenshot({ path: 'artifacts/admin.png', fullPage: true })
    console.log('screenshot: artifacts/admin.png')
  } catch (err) {
    check('v9-v11: admin UI flow', false, String(err).split('\n')[0])
    await page.screenshot({ path: 'artifacts/admin.png', fullPage: true }).catch(() => {})
  } finally {
    await browser.close()
  }
} finally {
  await cleanupAnalytics().catch(() => {})
  await client.end().catch(() => {})
  console.log('re-running seed.mjs …')
  execSync('node server/seed.mjs', { stdio: 'pipe' })
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
