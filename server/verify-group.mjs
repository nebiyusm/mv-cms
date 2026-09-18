#!/usr/bin/env node
/**
 * server/verify-group.mjs — end-to-end check of GET /api/availability and
 * POST /api/bookings/group against the running dev server + real DB.
 *
 *   (a) happy path: 4 guests across >= 2 rooms on a FRESH range (today+20..+23)
 *       -> expect 201, count 4; pg-confirm exactly 4 bookings + 4 booking_beds
 *   (b) atomicity: group where one bed is now occupied -> expect 409, and
 *       pg-confirm NONE of that group's guests/bookings/booking_beds exist
 *   (c) duplicate bedId in entries -> expect 400 validation_error
 *
 * Usage: node server/verify-group.mjs   (dev server must be running on :3001)
 */
import pg from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres.wkdxxriozqanfihpdkbm:RonaKori%232026@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'

const { Client } = pg

function day(offset) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const checkIn = day(20)
const checkOut = day(23)
console.log(`fresh range: ${checkIn} -> ${checkOut}`)

// Pick 6 free active beds at ADD spanning >= 2 rooms (4 for group A, 2 spare).
const { rows: freeBeds } = await client.query(
  `select b.id as bed_id, b.label, r.name as room_name
     from beds b
     join rooms r on r.id = b.room_id
     join properties p on p.id = r.property_id
    where p.code = 'ADD'
      and b.status = 'active'
      and not exists (
            select 1 from booking_beds bb
             where bb.bed_id = b.id and bb.is_active
               and bb.stay && daterange($1, $2))
    order by r.name, b.label`,
  [checkIn, checkOut],
)
const rooms = new Set(freeBeds.map((b) => b.room_name))
if (freeBeds.length < 6 || rooms.size < 2) {
  console.error(`need >= 6 free beds across >= 2 rooms, found ${freeBeds.length} beds in ${rooms.size} rooms`)
  process.exit(1)
}
const groupBeds = []
const usedRooms = new Set()
for (const bed of freeBeds) {
  if (groupBeds.length < 2 || (groupBeds.length < 4 && !usedRooms.has(bed.room_name))) {
    groupBeds.push(bed)
    usedRooms.add(bed.room_name)
  }
  if (groupBeds.length === 4) break
}
// ensure >= 2 rooms in the group
if (new Set(groupBeds.map((b) => b.room_name)).size < 2) {
  groupBeds[3] = freeBeds.find((b) => b.room_name !== groupBeds[0].room_name)
}
const spareBeds = freeBeds.filter((b) => !groupBeds.some((g) => g.bed_id === b.bed_id)).slice(0, 2)

const post = (body) =>
  fetch(`${API}/api/bookings/group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/* ---------------- (a) happy path ---------------- */
const namesA = ['GROUP TEST A1', 'GROUP TEST A2', 'GROUP TEST A3', 'GROUP TEST A4']
const resA = await post({
  propertyCode: 'ADD',
  checkIn,
  checkOut,
  entries: namesA.map((fullName, i) => ({ guest: { fullName }, bedId: groupBeds[i].bed_id })),
})
const bodyA = await resA.json()
check('a1: group booking returns 201', resA.status === 201, `got ${resA.status}`)
check(
  'a2: response has 4 bookingIds and count=4',
  Array.isArray(bodyA.bookingIds) && bodyA.bookingIds.length === 4 && bodyA.count === 4,
  JSON.stringify(bodyA).slice(0, 120),
)

const { rows: dbBookings } = await client.query(
  'select id, guest_id, source from bookings where id = any($1::uuid[])',
  [bodyA.bookingIds ?? []],
)
const { rows: dbBeds } = await client.query(
  'select booking_id, bed_id, stay from booking_beds where booking_id = any($1::uuid[])',
  [bodyA.bookingIds ?? []],
)
check('a3: exactly 4 bookings in DB', dbBookings.length === 4, `found ${dbBookings.length}`)
check('a4: exactly 4 booking_beds in DB', dbBeds.length === 4, `found ${dbBeds.length}`)
check(
  'a5: booking_beds reference the requested beds',
  groupBeds.every((g) => dbBeds.some((bb) => bb.bed_id === g.bed_id)),
)
check('a6: source defaulted to walk_in', dbBookings.every((b) => b.source === 'walk_in'))

// availability no longer lists the booked beds
const avail = await (
  await fetch(`${API}/api/availability?propertyCode=ADD&checkIn=${checkIn}&checkOut=${checkOut}`)
).json()
check(
  'a7: booked beds no longer in availability',
  groupBeds.every((g) => !avail.beds.some((b) => b.bedId === g.bed_id)),
  `${avail.beds.length} beds still free`,
)

/* ---------------- (b) atomicity / 409 ---------------- */
const namesB = ['GROUP TEST B1', 'GROUP TEST B2', 'GROUP TEST B3']
const bookingsBefore = (await client.query('select count(*)::int as n from bookings')).rows[0].n
const resB = await post({
  propertyCode: 'ADD',
  checkIn,
  checkOut,
  entries: [
    { guest: { fullName: namesB[0] }, bedId: spareBeds[0].bed_id },
    { guest: { fullName: namesB[1] }, bedId: groupBeds[0].bed_id }, // occupied by group A
    { guest: { fullName: namesB[2] }, bedId: spareBeds[1].bed_id },
  ],
})
const bodyB = await resB.json()
check('b1: group with one occupied bed returns 409', resB.status === 409, `got ${resB.status}`)
check(
  'b2: 409 body is {error:"conflict", bedId}',
  bodyB.error === 'conflict' && bodyB.bedId === groupBeds[0].bed_id,
  JSON.stringify(bodyB),
)
const { rows: ghosts } = await client.query(
  'select full_name from guests where full_name = any($1::text[])',
  [namesB],
)
const bookingsAfter = (await client.query('select count(*)::int as n from bookings')).rows[0].n
check('b3: no B-group guests persisted (rollback)', ghosts.length === 0, `found ${ghosts.length}`)
check(
  'b4: no new bookings/booking_beds persisted (rollback)',
  bookingsAfter === bookingsBefore,
  `${bookingsBefore} -> ${bookingsAfter}`,
)

/* ---------------- (c) duplicate bedId -> 400 ---------------- */
const resC = await post({
  propertyCode: 'ADD',
  checkIn,
  checkOut,
  entries: [
    { guest: { fullName: 'GROUP TEST C1' }, bedId: spareBeds[0].bed_id },
    { guest: { fullName: 'GROUP TEST C2' }, bedId: spareBeds[0].bed_id },
  ],
})
const bodyC = await resC.json()
check('c1: duplicate bedId returns 400', resC.status === 400, `got ${resC.status}`)
check('c2: 400 body is validation_error', bodyC.error === 'validation_error', JSON.stringify(bodyC).slice(0, 120))

/* ------------- (d) availability validation ------------- */
const resD = await fetch(`${API}/api/availability?propertyCode=ADD&checkIn=${checkOut}&checkOut=${checkIn}`)
check('d1: checkOut<=checkIn returns 400', resD.status === 400, `got ${resD.status}`)

await client.end()
const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
