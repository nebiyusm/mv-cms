#!/usr/bin/env node
/**
 * server/verify-dnd.mjs — verifies drag-and-drop bed reassignment on BedTimeline.
 *
 * Prereqs: `npm run dev` on http://localhost:5173, DB freshly seeded (server/seed.mjs).
 *
 * Scenario A  (overlap reject): drag Sofia Marchetti (Mixed Dorm Bed A) onto
 *   Mixed Dorm Bed B, whose booking overlaps her dates → rejection toast,
 *   pill back in place, booking_beds row UNCHANGED in Postgres.
 * Scenario A2 (maintenance reject): drag her onto Mixed Dorm Bed E
 *   (status = maintenance) → rejection toast, no DB write.
 * Scenario B  (accept): drag Lukas Weber (Mixed Dorm Bed D) onto the free
 *   Mixed Dorm Bed F → pill moves, DB row gets the new bed_id, stay unchanged.
 *
 * Drop targeting reads the TARGET GROUP's live foreground rect from vis's own
 * `itemSet.groups[...].dom.foreground` — the same rect vis hit-tests against —
 * because rows shift during the drag (stacked live preview expands rows).
 *
 * Screenshots: artifacts/dnd-rejected.png, artifacts/dnd-moved.png
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/'

const results = []
function report(name, pass, detail = '') {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir('artifacts', { recursive: true })

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()

  const bedId = async (roomName, label) => {
    const {
      rows: [row],
    } = await client.query(
      `select b.id from beds b
         join rooms r on r.id = b.room_id
         join properties p on p.id = r.property_id
        where p.code = 'ADD' and r.name = $1 and b.label = $2`,
      [roomName, label],
    )
    return row?.id
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

  /** booking_beds row for a guest (joins bookings -> guests) */
  async function rowByGuest(guestName) {
    const {
      rows: [row],
    } = await client.query(
      `select bb.id, bb.bed_id, bb.stay::text
         from booking_beds bb
         join bookings b on b.id = bb.booking_id
         join guests g on g.id = b.guest_id
        where g.full_name = $1 and bb.is_active
        limit 1`,
      [guestName],
    )
    return row
  }

  /** Live bounding box of a bed row, from vis's own group registry. */
  async function liveBedRowRect(id) {
    return page.evaluate((bedIdInner) => {
      const timeline = window.__timeline
      const group = timeline?.itemSet?.groups?.[`bed:${bedIdInner}`]
      if (!group) return null
      const r = group.dom.foreground.getBoundingClientRect()
      return { top: r.top, height: r.height }
    }, id)
  }

  async function pillBox(guestText) {
    return page.locator('.vis-item.mv-booking', { hasText: guestText }).first().boundingBox()
  }

  async function toastText() {
    try {
      await page.waitForSelector('.mv-toast', { timeout: 4000 })
      return ((await page.textContent('.mv-toast')) ?? '').trim()
    } catch {
      return ''
    }
  }

  async function waitToastGone() {
    await page
      .waitForSelector('.mv-toast', { state: 'detached', timeout: 8000 })
      .catch(() => {})
  }

  /**
   * Vertical drag (dates unchanged) onto a target bed row. Moves in steps and
   * self-corrects against the target row's LIVE rect — stacked drag previews
   * expand intermediate rows mid-gesture, shifting rows below.
   */
  async function dragPillToBed(guestText, targetBedId) {
    const from = await pillBox(guestText)
    if (!from) throw new Error(`no pill for ${guestText}`)
    const sx = from.x + from.width / 2
    const sy = from.y + from.height / 2

    await page.mouse.move(sx, sy)
    await page.mouse.down()
    // approach in coarse steps
    let rect = await liveBedRowRect(targetBedId)
    if (!rect) throw new Error(`no group rect for bed ${targetBedId}`)
    const coarseSteps = 8
    for (let i = 1; i <= coarseSteps; i++) {
      await page.mouse.move(sx, sy + ((rect.top + rect.height / 2 - sy) * i) / coarseSteps)
      await sleep(25)
    }
    // fine correction against the live (possibly shifted) rect
    for (let tries = 0; tries < 10; tries++) {
      rect = await liveBedRowRect(targetBedId)
      const center = rect.top + rect.height / 2
      await page.mouse.move(sx, center)
      await sleep(80)
      const check = await liveBedRowRect(targetBedId)
      if (Math.abs(check.top + check.height / 2 - center) < 2) break
    }
    await page.mouse.up()
    return { from }
  }

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    await page.waitForSelector('.vis-item.mv-booking .mv-pill', { timeout: 30000 })
    await sleep(500)

    const ROOM = 'Mixed Dorm (6-Bed)'
    const bedB = await bedId(ROOM, 'B')
    const bedE = await bedId(ROOM, 'E')
    const bedF = await bedId(ROOM, 'F')

    // ---------------- Scenario A: overlap -> rejected ----------------
    const beforeA = await rowByGuest('Sofia Marchetti')
    const fromA = await pillBox('Sofia Marchetti')
    await dragPillToBed('Sofia Marchetti', bedB)

    const toastA = await toastText()
    report(
      'overlap drag shows rejection feedback',
      toastA.toLowerCase().includes('occupied'),
      toastA || 'no toast',
    )
    await page.screenshot({ path: 'artifacts/dnd-rejected.png' })
    console.log('screenshot: artifacts/dnd-rejected.png')

    await sleep(1200) // let the flash animation settle
    const afterA = await pillBox('Sofia Marchetti')
    const backInPlace =
      Boolean(fromA && afterA) &&
      Math.abs(afterA.y - fromA.y) < 5 &&
      Math.abs(afterA.x - fromA.x) < 5
    report('rejected pill returns to its original spot', backInPlace)

    const dbA = await rowByGuest('Sofia Marchetti')
    report(
      'rejected move wrote nothing to the DB',
      Boolean(dbA && dbA.bed_id === beforeA.bed_id && dbA.stay === beforeA.stay),
      dbA ? `bed_id=${dbA.bed_id} stay=${dbA.stay}` : 'row missing',
    )
    await waitToastGone()

    // ------------- Scenario A2: maintenance bed -> rejected -------------
    await dragPillToBed('Sofia Marchetti', bedE)
    const toastA2 = await toastText()
    report(
      'maintenance-bed drag shows rejection feedback',
      toastA2.toLowerCase().includes('maintenance'),
      toastA2 || 'no toast',
    )
    const dbA2 = await rowByGuest('Sofia Marchetti')
    report(
      'maintenance rejection wrote nothing to the DB',
      Boolean(dbA2 && dbA2.bed_id === beforeA.bed_id && dbA2.stay === beforeA.stay),
    )
    await waitToastGone()

    // ---------------- Scenario B: free bed -> accepted ----------------
    const beforeB = await rowByGuest('Lukas Weber')
    await dragPillToBed('Lukas Weber', bedF)

    // wait for the optimistic move + realtime refetch to settle
    let movedBox = null
    let targetRect = null
    for (let i = 0; i < 20; i++) {
      await sleep(400)
      movedBox = await pillBox('Lukas Weber')
      targetRect = await liveBedRowRect(bedF)
      if (
        movedBox &&
        targetRect &&
        movedBox.y + movedBox.height / 2 >= targetRect.top &&
        movedBox.y + movedBox.height / 2 <= targetRect.top + targetRect.height
      )
        break
    }
    const pillMoved =
      Boolean(movedBox && targetRect) &&
      movedBox.y + movedBox.height / 2 >= targetRect.top &&
      movedBox.y + movedBox.height / 2 <= targetRect.top + targetRect.height
    report('accepted drag moves the pill onto the target bed row', pillMoved)

    let dbB = null
    for (let i = 0; i < 15; i++) {
      dbB = await rowByGuest('Lukas Weber')
      if (dbB && dbB.bed_id === bedF) break
      await sleep(400)
    }
    report(
      'accepted move persisted to the DB (new bed_id, same stay)',
      Boolean(dbB && dbB.bed_id === bedF && dbB.stay === beforeB.stay),
      dbB ? `bed_id=${dbB.bed_id} stay=${dbB.stay}` : 'row missing',
    )

    await page.screenshot({ path: 'artifacts/dnd-moved.png' })
    console.log('screenshot: artifacts/dnd-moved.png')
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
