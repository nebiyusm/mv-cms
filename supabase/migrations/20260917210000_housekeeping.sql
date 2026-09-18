-- Mad Vervet PMS — housekeeping status
--
-- beds.housekeeping_status: 'clean' | 'dirty' | 'out_of_order'.
-- Availability queries (front desk API, kiosk, extension flow) exclude
-- out-of-order beds — and the trigger below makes it a database-level rule
-- too, so even a write path that skips the availability check (e.g. direct
-- booking_beds insert from the timeline) cannot assign an out-of-order or
-- inactive bed.

begin;

alter table beds
  add column housekeeping_status text not null default 'clean'
  check (housekeeping_status in ('clean', 'dirty', 'out_of_order'));

create or replace function guard_bed_bookable()
returns trigger
language plpgsql
as $$
declare
  b beds%rowtype;
begin
  select * into b from beds where id = new.bed_id;
  if b.status <> 'active' then
    raise exception 'bed % is not active (status: %)', new.bed_id, b.status
      using errcode = 'check_violation';
  end if;
  if b.housekeeping_status = 'out_of_order' then
    raise exception 'bed % is out of order', new.bed_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_booking_beds_guard_bookable
before insert or update of bed_id on booking_beds
for each row execute function guard_bed_bookable();

commit;
