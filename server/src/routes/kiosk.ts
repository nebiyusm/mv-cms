import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  kioskCheckinBodySchema,
  kioskLookupBodySchema,
  type KioskCheckinErrorCode,
  type KioskCheckinErrorResponse,
  type KioskCheckinResponse,
  type KioskLookupResponse,
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

function kioskError(
  reply: FastifyReply,
  status: number,
  code: KioskCheckinErrorCode,
) {
  const body: KioskCheckinErrorResponse = { error: code };
  return reply.status(status).send(body);
}

interface BookingJoinRow {
  booking_id: string;
  status: string;
  guest_name: string;
  room_name: string;
  bed_label: string;
  room_type: string;
  check_in: string;
  check_out: string;
  property_name: string;
}

const BOOKING_JOIN = `
  from bookings bk
  join guests g on g.id = bk.guest_id
  join booking_beds bb on bb.booking_id = bk.id and bb.is_active
  join beds bd on bd.id = bb.bed_id
  join rooms r on r.id = bd.room_id
  join properties p on p.id = r.property_id
`;

const BOOKING_COLS = `
  bk.id as booking_id, bk.status, g.full_name as guest_name,
  r.name as room_name, bd.label as bed_label, r.room_type,
  lower(bb.stay)::text as check_in, upper(bb.stay)::text as check_out,
  p.name as property_name
`;

export function registerKioskRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/kiosk/lookup", async (request, reply) => {
    const parsed = kioskLookupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const { query } = parsed.data;
    const result = await pool.query<BookingJoinRow>(
      `
      select ${BOOKING_COLS}
      ${BOOKING_JOIN}
       where bk.status = 'confirmed'
         and bb.stay @> current_date
         and (
               g.full_name ilike '%' || $1 || '%'
               or bk.id::text ilike $1 || '%'
             )
       order by g.full_name
       limit 5
      `,
      [query],
    );

    const body: KioskLookupResponse = {
      results: result.rows.map((row) => ({
        bookingId: row.booking_id,
        reference: row.booking_id.slice(0, 8),
        guestName: row.guest_name,
        roomName: row.room_name,
        bedLabel: row.bed_label,
        roomType: row.room_type,
        checkIn: row.check_in,
        checkOut: row.check_out,
        propertyName: row.property_name,
      })),
    };
    return reply.status(200).send(body);
  });

  // Two ~4MB base64 images plus JSON overhead — raise Fastify's 1MB default.
  app.post(
    "/api/kiosk/checkin",
    { bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const parsed = kioskCheckinBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return validationError(reply, parsed.error);
      }

      const { bookingId, idPhoto, signature } = parsed.data;

      const client = await pool.connect();
      try {
        await client.query("begin");

        const found = await client.query<BookingJoinRow>(
          `
          select ${BOOKING_COLS}
          ${BOOKING_JOIN}
          where bk.id = $1
          for update of bk
          `,
          [bookingId],
        );

        if (found.rowCount === 0) {
          await client.query("rollback");
          return kioskError(reply, 404, "not_found");
        }

        const booking = found.rows[0];
        if (booking.status === "checked_in") {
          await client.query("rollback");
          return kioskError(reply, 409, "already_checked_in");
        }
        if (booking.status !== "confirmed") {
          await client.query("rollback");
          return kioskError(reply, 409, "booking_not_active");
        }

        const due = await client.query<{ due: boolean }>(
          `
          select exists (
                   select 1
                     from booking_beds bb
                    where bb.booking_id = $1
                      and bb.is_active
                      and bb.stay @> current_date
                 ) as due
          `,
          [bookingId],
        );
        if (!due.rows[0].due) {
          await client.query("rollback");
          return kioskError(reply, 409, "not_due");
        }

        await client.query(
          "update bookings set status = 'checked_in' where id = $1",
          [bookingId],
        );
        await client.query(
          "insert into check_ins (booking_id, id_image, signature_image) values ($1, $2, $3)",
          [bookingId, idPhoto, signature],
        );

        await client.query("commit");

        const body: KioskCheckinResponse = {
          bookingId: booking.booking_id,
          reference: booking.booking_id.slice(0, 8),
          guestName: booking.guest_name,
          roomName: booking.room_name,
          bedLabel: booking.bed_label,
          roomType: booking.room_type,
          propertyName: booking.property_name,
        };
        return reply.status(201).send(body);
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
  );
}
