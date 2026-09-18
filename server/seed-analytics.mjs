#!/usr/bin/env node
/**
 * server/seed-analytics.mjs — dense booking history for the /admin reports.
 *
 * Layers ONTO server/seed.mjs output (run that first). For every active bed
 * in both properties it lays down a deterministic tiling of 1-4 night stays
 * with 0-2 night gaps over [today-14, today+6), skipping any segment that
 * would overlap a stay already in place. Idempotent: re-running first
 * deletes the rows it created last time (guests named 'ANX GUEST *').
 *
 * Anchors on the DB's current_date (the DB clock can differ from local).
 *
 * Usage:  node server/seed-analytics.mjs
 */
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'

const { Client } = pg
const SOURCES = ['direct', 'booking_com', 'hostelworld', 'walk_in', 'phone']
const GUEST_PREFIX = 'ANX GUEST'

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// idempotency: wipe last run's rows
await client.query(
  `delete from bookings where guest_id in
     (select id from guests where full_name like $1)`,
  [`${GUEST_PREFIX}%`],
)
await client.query('delete from guests where full_name like $1', [`${GUEST_PREFIX}%`])

const { rows: [{ today }] } = await client.query('select current_date::text as today')

const beds = (
  await client.query(
    `select b.id as bed_id, p.code
       from beds b
       join rooms r on r.id = b.room_id
       join properties p on p.id = r.property_id
      where b.status = 'active'
      order by p.code, r.name, b.label`,
  )
).rows

let created = 0
let skipped = 0

for (const [i, bed] of beds.entries()) {
  const existing = (
    await client.query(
      `select lower(stay)::text as s, upper(stay)::text as e
         from booking_beds where bed_id = $1 and is_active`,
      [bed.bed_id],
    )
  ).rows

  // deterministic tiling: 1-4 night stays, 0-2 night gaps
  let cursor = -14
  let seg = 0
  while (cursor < 5) {
    const len = 1 + ((i + seg) % 4)
    const gap = (i * (seg + 1)) % 3
    const s = addDays(today, cursor)
    const e = addDays(today, cursor + len)
    cursor += len + gap
    seg += 1
    if (cursor > 6 && e > addDays(today, 5)) break

    const overlaps = existing.some((x) => s < x.e && x.s < e)
    if (overlaps) {
      skipped += 1
      continue
    }

    const guestId = (
      await client.query('insert into guests (full_name) values ($1) returning id', [
        `${GUEST_PREFIX} ${bed.code}-${i}-${seg}`,
      ])
    ).rows[0].id
    const bookingId = (
      await client.query('insert into bookings (guest_id, source) values ($1, $2) returning id', [
        guestId,
        SOURCES[(i + seg) % SOURCES.length],
      ])
    ).rows[0].id
    await client.query(
      'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))',
      [bookingId, bed.bed_id, s, e],
    )
    existing.push({ s, e })
    created += 1
  }
}

console.log(`analytics history: ${created} bookings created (${skipped} segments skipped, already occupied)`)
console.log('SEED ANALYTICS OK')
await client.end()
