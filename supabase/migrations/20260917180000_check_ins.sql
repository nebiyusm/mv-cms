-- Mad Vervet PMS — kiosk check-in captures
--
-- One row per completed kiosk check-in: the ID photo and signature captured
-- during the flow, linked to the booking.
--
-- DEV SIMPLIFICATION: images are stored as base64 data URLs in text columns.
-- The proper home for these is Supabase Storage (private bucket) with only a
-- reference here — move them when the storage module lands. These columns
-- hold sensitive PII (ID documents); they are intentionally NOT exposed to
-- the anon role (RLS enabled, no policies — only the server role writes them,
-- and only the service role can read them).

begin;

create table check_ins (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references bookings (id),
  id_image        text not null,        -- base64 data URL of the ID photo
  signature_image text not null,        -- base64 data URL of the signature
  created_at      timestamptz not null default now()
);

create index check_ins_booking_idx on check_ins (booking_id);

alter table check_ins enable row level security;
-- No policies: server-side (postgres role) access only.

commit;
