-- Mad Vervet PMS — folio line items + room nightly rates
--
-- folios existed but had nothing to record charges against; extensions and
-- POS items need line items. rooms.nightly_rate is the price source used by
-- the kiosk "extend my stay" flow (per-night rate of the guest's room).

begin;

alter table rooms
  add column nightly_rate numeric(10,2) not null default 20.00 check (nightly_rate >= 0);

create table folio_line_items (
  id          uuid primary key default gen_random_uuid(),
  folio_id    uuid not null references folios (id) on delete cascade,
  type        text not null check (type in ('room', 'extension', 'pos', 'payment')),
  description text not null,
  amount      numeric(10,2) not null,
  created_at  timestamptz not null default now()
);

create index folio_line_items_folio_idx on folio_line_items (folio_id);

alter table folio_line_items enable row level security;
-- No policies: server-side (postgres role) access only for now.

commit;
