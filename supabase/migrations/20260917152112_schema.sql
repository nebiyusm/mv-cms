-- Mad Vervet PMS — core schema (migration 0001)
-- Two properties, bed-level inventory, hard double-booking prevention.
-- Requires: PostgreSQL 14+ (Supabase default). No ORM — raw SQL only.

begin;

-- btree_gist is required for the exclusion constraints on (uuid, daterange).
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table properties (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code in ('ADD', 'NBO')),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rooms & beds
-- ---------------------------------------------------------------------------
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  name        text not null,
  room_type   text not null check (room_type in ('dorm', 'private')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (property_id, name)
);

create table beds (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms (id) on delete cascade,
  label      text not null,               -- 'A', 'B', 'C' for dorms; '1' for private rooms
  status     text not null default 'active' check (status in ('active', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, label)
);

-- ---------------------------------------------------------------------------
-- Guests
-- ---------------------------------------------------------------------------
create table guests (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  email            text,
  phone            text,
  id_document_type text,                  -- passport / national id — filled at kiosk check-in
  id_document_ref  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bookings
-- One booking covers one or more beds via booking_beds (group bookings).
-- ---------------------------------------------------------------------------
create table bookings (
  id         uuid primary key default gen_random_uuid(),
  guest_id   uuid not null references guests (id),
  source     text not null default 'direct'
             check (source in ('direct', 'booking_com', 'hostelworld', 'walk_in', 'phone')),
  status     text not null default 'confirmed'
             check (status in ('confirmed', 'checked_in', 'checked_out', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Booking ↔ bed assignments — the table that carries the hard constraint.
--
-- stay is a daterange with Postgres' default [) bounds: check-in day is
-- inclusive, check-out day is exclusive, so back-to-back bookings on the
-- same bed are legal.
--
-- The EXCLUDE constraint makes overlapping stays on the same bed physically
-- impossible at the database level, regardless of which channel (website,
-- OTA email parser, scraper, front desk, kiosk) performs the insert.
--
-- is_active mirrors bookings.status via trigger so that cancelling a
-- booking releases its beds without deleting history.
-- ---------------------------------------------------------------------------
create table booking_beds (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  bed_id     uuid not null references beds (id),
  stay       daterange not null check (not isempty(stay)),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  exclude using gist (bed_id with =, stay with &&) where (is_active)
);

create index booking_beds_bed_stay_idx on booking_beds using gist (bed_id, stay);

create or replace function sync_booking_beds_active()
returns trigger
language plpgsql
as $$
begin
  update booking_beds
     set is_active = (new.status <> 'cancelled')
   where booking_id = new.id;
  return new;
end;
$$;

create trigger trg_bookings_sync_beds_active
after insert or update of status on bookings
for each row execute function sync_booking_beds_active();

-- ---------------------------------------------------------------------------
-- Folios — one ledger per booking (group split handled at payment level later)
-- ---------------------------------------------------------------------------
create table folios (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings (id) on delete set null,
  guest_id   uuid not null references guests (id),
  status     text not null default 'open' check (status in ('open', 'closed')),
  currency   text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_touch_properties    before update on properties    for each row execute function touch_updated_at();
create trigger trg_touch_rooms         before update on rooms         for each row execute function touch_updated_at();
create trigger trg_touch_beds          before update on beds          for each row execute function touch_updated_at();
create trigger trg_touch_guests        before update on guests        for each row execute function touch_updated_at();
create trigger trg_touch_bookings      before update on bookings      for each row execute function touch_updated_at();
create trigger trg_touch_booking_beds  before update on booking_beds  for each row execute function touch_updated_at();
create trigger trg_touch_folios        before update on folios        for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security — STUBBED, not implemented.
--
-- RLS is enabled now so no table is accidentally exposed via Supabase's
-- anon/authenticated roles, but no policies exist yet, which means all
-- non-service-role access is denied until the auth pass writes real
-- policies. Intended policy stubs (to be implemented with the auth module):
--
--   create policy "staff read properties"   on properties   for select to authenticated using (true);
--   create policy "staff manage bookings"   on bookings     for all    to authenticated using (true);
--   create policy "kiosk limited access"    on booking_beds for select to anon          using (is_active);
--
-- Until then, use the service_role key (server-side only) or the SQL editor.
-- ---------------------------------------------------------------------------
alter table properties   enable row level security;
alter table rooms        enable row level security;
alter table beds         enable row level security;
alter table guests       enable row level security;
alter table bookings     enable row level security;
alter table booking_beds enable row level security;
alter table folios       enable row level security;

commit;
