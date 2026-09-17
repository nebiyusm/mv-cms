-- Mad Vervet PMS — dev read policies + realtime publication
--
-- The front-desk timeline reads through the Supabase JS client (anon key).
-- RLS is enabled on all tables but no policies existed, so anon reads were
-- fully denied. These are DEVELOPMENT-ONLY permissive read policies to
-- unblock the UI before the auth module exists. They MUST be replaced with
-- role-scoped policies when auth lands (they currently expose guest PII to
-- anyone with the anon key).

begin;

create policy "dev read properties"   on properties   for select to anon, authenticated using (true);
create policy "dev read rooms"        on rooms        for select to anon, authenticated using (true);
create policy "dev read beds"         on beds         for select to anon, authenticated using (true);
create policy "dev read guests"       on guests       for select to anon, authenticated using (true);
create policy "dev read bookings"     on bookings     for select to anon, authenticated using (true);
create policy "dev read booking_beds" on booking_beds for select to anon, authenticated using (true);

-- Realtime: stream changes on the inventory/booking tables to subscribers.
-- replica identity full so UPDATE/DELETE payloads carry enough to reconcile
-- client-side caches.
alter table bookings     replica identity full;
alter table booking_beds replica identity full;
alter table beds         replica identity full;

alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table booking_beds;
alter publication supabase_realtime add table beds;

commit;
