-- Mad Vervet PMS — dev write policies for drag-and-drop bed reassignment
--
-- DEVELOPMENT-ONLY, like the read policies before them: the timeline UI
-- writes through the anon key until the auth module lands. Scoped to
-- booking_beds (reassignment = UPDATE bed_id/stay; INSERT/DELETE included
-- for upcoming booking create/cancel from the UI). bookings UPDATE is
-- included for status transitions. Replace with role-scoped policies in the
-- auth pass.

begin;

create policy "dev write booking_beds" on booking_beds
  for all to anon, authenticated
  using (true) with check (true);

create policy "dev write bookings" on bookings
  for all to anon, authenticated
  using (true) with check (true);

commit;
