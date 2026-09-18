-- Mad Vervet PMS — folio balances view + dev read access + realtime
--
-- folio_balances: computed charges/payments/balance per folio.
-- Convention: charges (room/extension/pos) are positive, payments negative,
-- so balance = sum of all line items.
--
-- Dev read policies for anon (same posture as the earlier dev policies —
-- tighten in the auth pass) + realtime publication so the folio view updates
-- the moment the Stripe webhook writes the payment line item (no polling).

begin;

create or replace view folio_balances as
select
  f.id as folio_id,
  f.booking_id,
  f.guest_id,
  f.status,
  f.currency,
  coalesce(sum(li.amount) filter (where li.type <> 'payment'), 0) as charges,
  coalesce(-sum(li.amount) filter (where li.type = 'payment'), 0) as payments,
  coalesce(sum(li.amount), 0) as balance
from folios f
left join folio_line_items li on li.folio_id = f.id
group by f.id;

create policy "dev read folios"            on folios            for select to anon, authenticated using (true);
create policy "dev read folio_line_items"  on folio_line_items  for select to anon, authenticated using (true);

alter table folios            replica identity full;
alter table folio_line_items  replica identity full;

alter publication supabase_realtime add table folios;
alter publication supabase_realtime add table folio_line_items;

commit;
