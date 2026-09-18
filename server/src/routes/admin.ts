import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  adminStatsQuerySchema,
  type AdminStatsResponse,
  type ValidationErrorResponse,
} from "../types.js";

function validationError(reply: FastifyReply, error: ZodError) {
  const body: ValidationErrorResponse = {
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
  return reply.status(400).send(body);
}

interface DailyRow {
  date: string;
  occupied_bed_nights: number;
  available_bed_nights: number;
  revenue: number;
}

/**
 * Occupancy per day:
 *   occupied bed-night  = a bed covered by an active (non-cancelled)
 *                         booking_beds row on that calendar day
 *   available bed-night = beds with status='active' (same count every day)
 *   revenue             = occupied bed-nights x the booked room's nightly_rate
 */
const DAILY_SQL = `
  with days as (
    select generate_series($2::date, $3::date - 1, interval '1 day')::date as day
  ),
  avail as (
    select count(*)::int as n
      from beds b
      join rooms r on r.id = b.room_id
      join properties p on p.id = r.property_id
     where p.code = $1
       and b.status = 'active'
  )
  select d.day::text as date,
         count(x.bed_id)::int as occupied_bed_nights,
         a.n as available_bed_nights,
         coalesce(sum(x.nightly_rate), 0)::float8 as revenue
    from days d
    cross join avail a
    left join (
      select bb.stay, bb.bed_id, r.nightly_rate
        from booking_beds bb
        join beds b on b.id = bb.bed_id
        join rooms r on r.id = b.room_id
        join properties p on p.id = r.property_id
       where bb.is_active
         and p.code = $1
    ) x on x.stay @> d.day
   group by d.day, a.n
   order by d.day
`;

const CHANNELS_SQL = `
  select bk.source,
         count(distinct bk.id)::int as bookings,
         coalesce(sum(
           r.nightly_rate * (upper(bb.stay * daterange($2, $3)) - lower(bb.stay * daterange($2, $3)))
         ), 0)::float8 as revenue
    from bookings bk
    join booking_beds bb on bb.booking_id = bk.id and bb.is_active
    join beds b on b.id = bb.bed_id
    join rooms r on r.id = b.room_id
    join properties p on p.id = r.property_id
   where p.code = $1
     and bb.stay && daterange($2, $3)
   group by bk.source
   order by bookings desc, bk.source
`;

const TODAY_SQL = `
  with prop_beds as (
    select b.id
      from beds b
      join rooms r on r.id = b.room_id
      join properties p on p.id = r.property_id
     where p.code = $1
       and b.status = 'active'
  ),
  prop_stays as (
    select bb.booking_id, bb.bed_id, bb.stay
      from booking_beds bb
      join prop_beds pb on pb.id = bb.bed_id
     where bb.is_active
  )
  select
    (select count(*) from prop_beds)::int as available,
    (select count(*) from prop_stays where stay @> current_date)::int as in_house,
    (select count(distinct booking_id) from prop_stays where lower(stay) = current_date)::int as arrivals,
    (select count(distinct booking_id) from prop_stays where upper(stay) = current_date)::int as checkouts_today
`;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function registerAdminRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/admin/stats", async (request, reply) => {
    const parsed = adminStatsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const { propertyCode, from, to } = parsed.data;

    const [dailyResult, channelsResult, todayResult] = await Promise.all([
      pool.query<DailyRow>(DAILY_SQL, [propertyCode, from, to]),
      pool.query<{ source: string; bookings: number; revenue: number }>(
        CHANNELS_SQL,
        [propertyCode, from, to],
      ),
      pool.query<{ available: number; in_house: number; arrivals: number; checkouts_today: number }>(
        TODAY_SQL,
        [propertyCode],
      ),
    ]);

    const daily = dailyResult.rows.map((row) => {
      const occupied = Number(row.occupied_bed_nights);
      const available = Number(row.available_bed_nights);
      const revenue = Number(row.revenue);
      return {
        date: row.date,
        occupiedBedNights: occupied,
        availableBedNights: available,
        occupancyPct: available > 0 ? round2((100 * occupied) / available) : 0,
        revenue: round2(revenue),
        adr: occupied > 0 ? round2(revenue / occupied) : 0,
        revpar: available > 0 ? round2(revenue / available) : 0,
      };
    });

    const occupiedBedNights = daily.reduce((sum, d) => sum + d.occupiedBedNights, 0);
    const availableBedNights = daily.reduce((sum, d) => sum + d.availableBedNights, 0);
    const revenue = round2(daily.reduce((sum, d) => sum + d.revenue, 0));

    const todayRow = todayResult.rows[0];
    const todayAvailable = Number(todayRow.available);

    const body: AdminStatsResponse = {
      daily,
      totals: {
        occupancyPct: availableBedNights > 0 ? round2((100 * occupiedBedNights) / availableBedNights) : 0,
        adr: occupiedBedNights > 0 ? round2(revenue / occupiedBedNights) : 0,
        revpar: availableBedNights > 0 ? round2(revenue / availableBedNights) : 0,
        revenue,
        occupiedBedNights,
        availableBedNights,
      },
      channels: channelsResult.rows.map((row) => ({
        source: row.source,
        bookings: Number(row.bookings),
        revenue: round2(Number(row.revenue)),
      })),
      today: {
        occupancyPct: todayAvailable > 0 ? round2((100 * Number(todayRow.in_house)) / todayAvailable) : 0,
        arrivals: Number(todayRow.arrivals),
        inHouse: Number(todayRow.in_house),
        checkoutsToday: Number(todayRow.checkouts_today),
      },
    };
    return reply.status(200).send(body);
  });
}
