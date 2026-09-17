#!/usr/bin/env node
/**
 * server/seed.mjs — seed the Supabase DB with realistic hostel demo data.
 *
 * Idempotent-ish: wipes ALL existing rows (booking_beds, bookings, folios,
 * guests, beds, rooms, properties) and inserts a fresh demo set:
 *   - both properties (ADD / NBO)
 *   - per property: 2 dorms (6-bed mixed, 4-bed female) + 1 private room
 *   - ~10 guests, ~12 bookings with mixed sources
 *   - stay ranges spanning from a few days BEFORE today through ~2 weeks after
 *   - 1 bed per property set to maintenance
 *
 * Usage:
 *   node server/seed.mjs            # uses the default pooler URL below
 *   DATABASE_URL=... node server/seed.mjs
 */
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'

const { Client } = pg

/** YYYY-MM-DD for today + offset (local time) */
function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const GUEST_NAMES = [
  'Sofia Marchetti',
  'Daniel Otieno',
  'Priya Nair',
  'Lukas Weber',
  'Amina Yusuf',
  'Tomás Silva',
  'Jens Berg',
  'Wanjiru Kamau',
  'Martina Rossi',
  'Chen Wei',
]

const SOURCES = ['booking_com', 'hostelworld', 'direct', 'walk_in']

// (propertyIndex, roomIndex, bedIndex, startOffset, nights, source, status)
// startOffset is relative to today; stay = [start, start+nights)
const BOOKING_PLAN = [
  // ADD (property 0): rooms 0 = Mixed Dorm, 1 = Female Dorm, 2 = Private
  { prop: 0, room: 0, bed: 0, start: -2, nights: 4, source: 'booking_com', status: 'checked_in' },
  { prop: 0, room: 0, bed: 1, start: 0, nights: 3, source: 'hostelworld', status: 'confirmed' },
  { prop: 0, room: 0, bed: 2, start: -4, nights: 3, source: 'walk_in', status: 'checked_in' },
  { prop: 0, room: 0, bed: 3, start: 2, nights: 5, source: 'direct', status: 'confirmed' },
  { prop: 0, room: 1, bed: 0, start: 1, nights: 2, source: 'hostelworld', status: 'confirmed' },
  { prop: 0, room: 2, bed: 0, start: 0, nights: 4, source: 'booking_com', status: 'confirmed' },
  // NBO (property 1)
  { prop: 1, room: 0, bed: 0, start: -1, nights: 3, source: 'direct', status: 'checked_in' },
  { prop: 1, room: 0, bed: 2, start: 3, nights: 4, source: 'booking_com', status: 'confirmed' },
  { prop: 1, room: 1, bed: 1, start: 5, nights: 3, source: 'hostelworld', status: 'confirmed' },
  { prop: 1, room: 1, bed: 2, start: -3, nights: 5, source: 'walk_in', status: 'checked_in' },
  { prop: 1, room: 2, bed: 0, start: 7, nights: 4, source: 'direct', status: 'confirmed' },
  { prop: 1, room: 0, bed: 4, start: 9, nights: 3, source: 'booking_com', status: 'confirmed' },
]

async function main() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  console.log('Connected. Seeding demo data (today =', day(0), ')…')

  try {
    await client.query('begin')

    // ---- wipe existing demo rows (order matters for FKs) ----
    await client.query('delete from folios')
    await client.query('delete from booking_beds')
    await client.query('delete from bookings')
    await client.query('delete from guests')
    await client.query('delete from beds')
    await client.query('delete from rooms')
    await client.query('delete from properties')

    // ---- properties ----
    const { rows: properties } = await client.query(
      `insert into properties (code, name) values ('ADD', 'Addis Ababa'), ('NBO', 'Nairobi')
       returning id, code`,
    )
    properties.sort((a, b) => a.code.localeCompare(b.code))
    console.log('properties:', properties.map((p) => p.code).join(', '))

    // ---- rooms + beds per property ----
    const roomDefs = [
      { name: 'Mixed Dorm (6-Bed)', room_type: 'dorm', beds: ['A', 'B', 'C', 'D', 'E', 'F'] },
      { name: 'Female Dorm (4-Bed)', room_type: 'dorm', beds: ['A', 'B', 'C', 'D'] },
      { name: 'Private Double', room_type: 'private', beds: ['1'] },
    ]

    // bedIds[prop][room][bed] = bed uuid
    const bedIds = []
    for (const property of properties) {
      const propRooms = []
      for (const def of roomDefs) {
        const {
          rows: [room],
        } = await client.query(
          'insert into rooms (property_id, name, room_type) values ($1, $2, $3) returning id',
          [property.id, def.name, def.room_type],
        )
        const beds = []
        for (const label of def.beds) {
          const {
            rows: [bed],
          } = await client.query('insert into beds (room_id, label) values ($1, $2) returning id', [
            room.id,
            label,
          ])
          beds.push(bed.id)
        }
        propRooms.push(beds)
      }
      bedIds.push(propRooms)
    }

    // ---- maintenance: one dorm bed per property ----
    await client.query('update beds set status = $1 where id = $2', [
      'maintenance',
      bedIds[0][0][4], // ADD Mixed Dorm bed E
    ])
    await client.query('update beds set status = $1 where id = $2', [
      'maintenance',
      bedIds[1][1][3], // NBO Female Dorm bed D
    ])
    console.log('maintenance beds set: 2')

    // ---- guests ----
    const guestIds = []
    for (const name of GUEST_NAMES) {
      const {
        rows: [guest],
      } = await client.query('insert into guests (full_name) values ($1) returning id', [name])
      guestIds.push(guest.id)
    }
    console.log('guests:', guestIds.length)

    // ---- bookings + booking_beds ----
    let count = 0
    for (let i = 0; i < BOOKING_PLAN.length; i++) {
      const plan = BOOKING_PLAN[i]
      const bedId = bedIds[plan.prop][plan.room][plan.bed]
      const source = plan.source ?? SOURCES[i % SOURCES.length]
      const {
        rows: [booking],
      } = await client.query(
        'insert into bookings (guest_id, source, status) values ($1, $2, $3) returning id',
        [guestIds[i % guestIds.length], source, plan.status],
      )
      await client.query(
        'insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))',
        [booking.id, bedId, day(plan.start), day(plan.start + plan.nights)],
      )
      count++
    }
    console.log('bookings:', count)

    await client.query('commit')
    console.log('SEED OK')
  } catch (err) {
    await client.query('rollback')
    console.error('SEED FAILED:', err.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
