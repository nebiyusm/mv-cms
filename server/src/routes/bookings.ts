import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  createBookingBodySchema,
  type BookingCreatedResponse,
  type ConflictResponse,
  type NoAvailabilityResponse,
  type ValidationErrorResponse,
} from "../types.js";

interface AvailableBedRow {
  bed_id: string;
  bed_label: string;
  room_name: string;
}

const AVAILABILITY_SQL = `
  select b.id as bed_id, b.label as bed_label, r.name as room_name
    from beds b
    join rooms r on r.id = b.room_id
    join properties p on p.id = r.property_id
   where p.code = $1
     and r.room_type = $2
     and b.status = 'active'
     and not exists (
           select 1
             from booking_beds bb
            where bb.bed_id = b.id
              and bb.is_active
              and bb.stay && daterange($3, $4)
         )
   order by r.name, b.label
   limit 1
`;

export function registerBookingRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/bookings", async (request, reply) => {
    const parsed = createBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const body: ValidationErrorResponse = {
        error: "validation_error",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
      return reply.status(400).send(body);
    }

    const { propertyCode, roomType, checkIn, checkOut, guest, source } = parsed.data;

    // Availability check (outside the write transaction; the EXCLUDE
    // constraint on booking_beds is the final guard against races).
    const available = await pool.query<AvailableBedRow>(AVAILABILITY_SQL, [
      propertyCode,
      roomType,
      checkIn,
      checkOut,
    ]);

    if (available.rowCount === 0) {
      const body: NoAvailabilityResponse = {
        error: "no_availability",
        propertyCode,
        roomType,
        stay: { checkIn, checkOut },
      };
      return reply.status(409).send(body);
    }

    const bed = available.rows[0];
    const client = await pool.connect();
    try {
      await client.query("begin");

      const guestResult = await client.query<{ id: string }>(
        "insert into guests (full_name, email, phone) values ($1, $2, $3) returning id",
        [guest.fullName, guest.email ?? null, guest.phone ?? null],
      );
      const guestId = guestResult.rows[0].id;

      const bookingResult = await client.query<{ id: string }>(
        "insert into bookings (guest_id, source) values ($1, $2) returning id",
        [guestId, source],
      );
      const bookingId = bookingResult.rows[0].id;

      await client.query(
        "insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))",
        [bookingId, bed.bed_id, checkIn, checkOut],
      );

      await client.query("commit");

      const body: BookingCreatedResponse = {
        bookingId,
        bedId: bed.bed_id,
        bedLabel: bed.bed_label,
        roomName: bed.room_name,
        propertyCode,
        stay: { checkIn, checkOut },
      };
      return reply.status(201).send(body);
    } catch (err) {
      await client.query("rollback");
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "23P01"
      ) {
        const body: ConflictResponse = { error: "conflict" };
        return reply.status(409).send(body);
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
