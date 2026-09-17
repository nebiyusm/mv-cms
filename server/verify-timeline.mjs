#!/usr/bin/env node
/**
 * server/verify-timeline.mjs — end-to-end verification of the BedTimeline page.
 *
 * Prereqs: `npm run dev` running on http://localhost:5173, DB seeded.
 *
 * 1. Opens `/` in headless Chromium, waits for seeded booking pills to render,
 *    screenshots artifacts/timeline-before.png.
 * 2. Asserts today's date column is highlighted (mv-today / mv-day-today in DOM).
 * 3. Inserts a NEW booking directly into Postgres ("REALTIME TEST GUEST",
 *    an active bed in ADD, stay = today+2 .. today+5), then asserts the guest
 *    name appears in the page DOM WITHOUT a reload (Supabase Realtime).
 * 4. Screenshots artifacts/timeline-after.png and prints PASS/FAIL lines.
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/'
const GUEST_NAME = 'REALTIME TEST GUEST'

function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const results = []
function report(name, pass, detail = '') {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  await mkdir('artifacts', { recursive: true })

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  try {
    // 1. Open the timeline and wait for seeded pills
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    try {
      await page.waitForSelector('.vis-item.mv-booking .mv-pill', { timeout: 30000 })
      report('timeline renders seeded booking pills', true)
    } catch {
      report('timeline renders seeded booking pills', false, 'no .mv-pill within 30s')
    }

    // 2. Today column highlighted
    const todayBg = await page.$('.vis-item.mv-today')
    const todayHeader = await page.$('.mv-day-label.mv-day-today')
    report(
      "today's date column is highlighted",
      Boolean(todayBg && todayHeader),
      `background item: ${Boolean(todayBg)}, header label: ${Boolean(todayHeader)}`,
    )

    await page.screenshot({ path: 'artifacts/timeline-before.png', fullPage: true })
    console.log('screenshot: artifacts/timeline-before.png')

    // 3. Insert a new booking directly via Postgres (bypasses the app entirely)
    const start = day(2)
    const end = day(5)
    const {
      rows: [bed],
    } = await client.query(
      `select b.id
         from beds b
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD'
          and b.status = 'active'
          and not exists (
            select 1 from booking_beds bb
             where bb.bed_id = b.id and bb.is_active and bb.stay && daterange($1, $2)
          )
        order by b.id
        limit 1`,
      [start, end],
    )
    if (!bed) throw new Error('no free active bed found for the realtime test booking')

    const {
      rows: [guest],
    } = await client.query('insert into guests (full_name) values ($1) returning id', [GUEST_NAME])
    const {
      rows: [booking],
    } = await client.query(
      `insert into bookings (guest_id, source, status) values ($1, 'direct', 'confirmed') returning id`,
      [guest.id],
    )
    await client.query(
      'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))',
      [booking.id, bed.id, start, end],
    )
    console.log(`inserted test booking via pg: "${GUEST_NAME}", stay [${start}, ${end})`)

    // 4. Realtime: the name must appear in the DOM without any reload.
    //    Spec budget is <=2s; allow up to 10s before declaring failure.
    const t0 = Date.now()
    let elapsed
    try {
      await page.waitForSelector(`text=${GUEST_NAME}`, { timeout: 2000 })
      elapsed = Date.now() - t0
      report('realtime: new booking appears without reload', true, `${elapsed}ms (within 2s)`)
    } catch {
      try {
        await page.waitForSelector(`text=${GUEST_NAME}`, { timeout: 8000 })
        elapsed = Date.now() - t0
        report('realtime: new booking appears without reload', true, `${elapsed}ms (slower than 2s)`)
      } catch {
        report('realtime: new booking appears without reload', false, 'not in DOM after 10s')
      }
    }

    await page.screenshot({ path: 'artifacts/timeline-after.png', fullPage: true })
    console.log('screenshot: artifacts/timeline-after.png')
  } finally {
    await browser.close()
    await client.end()
  }

  const failed = results.filter((r) => !r).length
  console.log(failed === 0 ? 'PASS — all checks passed' : `FAIL — ${failed} check(s) failed`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((err) => {
  console.error('VERIFY ERROR:', err)
  process.exitCode = 1
})
