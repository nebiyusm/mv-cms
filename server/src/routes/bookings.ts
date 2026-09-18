import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  availabilityQuerySchema,
  createBookingBodySchema,
  groupBookingBodySchema,
  type AvailabilityResponse,
  type BookingCreatedResponse,
  type ConflictResponse,
  type GroupBookingCreatedResponse,
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
     and b.housekeeping_status <> 'out_of_order'
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

export function registerBookingRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/availability", async (request, reply) => {
    const parsed = availabilityQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const { propertyCode, checkIn, checkOut } = parsed.data;
    const result = await pool.query<{
      bed_id: string;
      bed_label: string;
      room_id: string;
      room_name: string;
      room_type: string;
    }>(
      `
      select b.id as bed_id, b.label as bed_label, r.id as room_id,
             r.name as room_name, r.room_type
        from beds b
        join rooms r on r.id = b.room_id
        join properties p on p.id = r.property_id
       where p.code = $1
         and b.status = 'active'
         and b.housekeeping_status <> 'out_of_order'
         and not exists (
               select 1
                 from booking_beds bb
                where bb.bed_id = b.id
                  and bb.is_active
                  and bb.stay && daterange($2, $3)
             )
       order by r.name, b.label
      `,
      [propertyCode, checkIn, checkOut],
    );

    const body: AvailabilityResponse = {
      beds: result.rows.map((row) => ({
        bedId: row.bed_id,
        bedLabel: row.bed_label,
        roomId: row.room_id,
        roomName: row.room_name,
        roomType: row.room_type,
      })),
    };
    return reply.status(200).send(body);
  });

  app.post("/api/bookings/group", async (request, reply) => {
    const parsed = groupBookingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const { propertyCode, checkIn, checkOut, source, entries } = parsed.data;
    const bedIds = entries.map((entry) => entry.bedId);

    const client = await pool.connect();
    try {
      await client.query("begin");

      // Re-validate every requested bed inside the transaction: it must
      // exist, belong to the property, be active, and have no overlapping
      // active booking for the stay range.
      const check = await client.query<{
        id: string;
        status: string;
        housekeeping_status: string;
        code: string;
        occupied: boolean;
      }>(
        `
        select b.id, b.status, b.housekeeping_status, p.code,
               exists (
                 select 1
                   from booking_beds bb
                  where bb.bed_id = b.id
                    and bb.is_active
                    and bb.stay && daterange($2, $3)
               ) as occupied
          from beds b
          join rooms r on r.id = b.room_id
          join properties p on p.id = r.property_id
         where b.id = any($1::uuid[])
        `,
        [bedIds, checkIn, checkOut],
      );

      const bedsById = new Map(check.rows.map((row) => [row.id, row]));
      for (const entry of entries) {
        const bed = bedsById.get(entry.bedId);
        if (
          !bed ||
          bed.code !== propertyCode ||
          bed.status !== "active" ||
          bed.housekeeping_status === "out_of_order" ||
          bed.occupied
        ) {
          await client.query("rollback");
          const body: ConflictResponse = { error: "conflict", bedId: entry.bedId };
          return reply.status(409).send(body);
        }
      }

      const bookingIds: string[] = [];
      for (const entry of entries) {
        const guestResult = await client.query<{ id: string }>(
          "insert into guests (full_name, email, phone) values ($1, $2, $3) returning id",
          [entry.guest.fullName, entry.guest.email ?? null, entry.guest.phone ?? null],
        );
        const guestId = guestResult.rows[0].id;

        const bookingResult = await client.query<{ id: string }>(
          "insert into bookings (guest_id, source) values ($1, $2) returning id",
          [guestId, source],
        );
        const bookingId = bookingResult.rows[0].id;
        bookingIds.push(bookingId);

        await client.query(
          "insert into booking_beds (booking_id, bed_id, stay) values ($1, $2, daterange($3, $4))",
          [bookingId, entry.bedId, checkIn, checkOut],
        );
      }

      await client.query("commit");

      const body: GroupBookingCreatedResponse = {
        bookingIds,
        count: bookingIds.length,
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
