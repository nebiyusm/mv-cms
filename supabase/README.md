# Mad Vervet PMS — Database Schema

Raw SQL migrations for the bed-level PMS. Apply against a Supabase project
with `supabase db push` (CLI) or by pasting the migration into the SQL editor.

## Tables

`properties` → `rooms` → `beds` form the inventory hierarchy (two properties:
`ADD` Addis Ababa, `NBO` Nairobi). A `booking` belongs to one guest and
reserves **one or more beds** through the `booking_beds` join table — that's
what makes group bookings and split rooming lists possible. `folios` is the
billing ledger hanging off a booking/guest.

## The double-booking constraint

The critical piece is in `booking_beds`:

```sql
exclude using gist (bed_id with =, stay with &&) where (is_active)
```

- `EXCLUDE USING gist` is a PostgreSQL **exclusion constraint** — an
  index-enforced rule, not an application check.
- `bed_id WITH =` — the rule applies per bed.
- `stay WITH &&` — two rows conflict when their date ranges **overlap**.
- `btree_gist` (created at the top of the migration) is what lets a `uuid`
  column participate in a GiST index alongside the range.
- `WHERE (is_active)` makes it a *partial* constraint: a cancelled booking
  releases its beds. `is_active` is kept in sync with `bookings.status` by
  the `sync_booking_beds_active()` trigger, so cancelling is just a status
  update — history is preserved.

`stay` is a `daterange` with Postgres' default `[)` bounds: check-in day
inclusive, check-out day exclusive. Two guests can share a bed on the
changeover day (one checks out, the next checks in) without violating the
constraint.

Because the rule lives in the database, **every write channel** — website
booking engine, OTA email parser, extranet scraper, front desk, kiosk — gets
the same guarantee for free. A conflicting insert fails with:

```
ERROR: conflicting key value violates exclusion constraint "booking_beds_bed_id_stay_excl"
```

## RLS status

Row-level security is **enabled on all tables but no policies exist yet**
(stubbed per the build prompt). Consequence: `anon`/`authenticated` roles are
denied everything until the auth module writes real policies. Use the
`service_role` key or the SQL editor for now.

## Verification

Run against the database after applying the migration:

```sql
-- setup
insert into properties (code, name) values ('ADD', 'Addis Ababa') returning id;
insert into rooms (property_id, name, room_type) values ('<prop>', 'Dorm 1', 'dorm') returning id;
insert into beds (room_id, label) values ('<room>', 'A') returning id;
insert into guests (full_name) values ('Test Guest') returning id;
insert into bookings (guest_id, source) values ('<guest>', 'walk_in') returning id;

-- 1) first booking: 2025-03-01 → 2025-03-05  (succeeds)
insert into booking_beds (booking_id, bed_id, stay)
values ('<booking>', '<bed>', daterange('2025-03-01', '2025-03-05'));

-- 2) overlapping booking on same bed: 2025-03-03 → 2025-03-07  (MUST FAIL)
insert into booking_beds (booking_id, bed_id, stay)
values ('<booking>', '<bed>', daterange('2025-03-03', '2025-03-07'));

-- 3) back-to-back on changeover day: 2025-03-05 → 2025-03-08  (succeeds — [) bounds)
insert into booking_beds (booking_id, bed_id, stay)
values ('<booking>', '<bed>', daterange('2025-03-05', '2025-03-08'));
```

Expected: statement 2 raises the exclusion-constraint error above;
statements 1 and 3 succeed.
