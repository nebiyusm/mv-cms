import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  kioskExtendCheckoutBodySchema,
  kioskLookupBodySchema,
  type KioskExtendCheckoutResponse,
  type KioskExtendErrorCode,
  type KioskExtendErrorResponse,
  type KioskExtendQuoteResponse,
  type KioskExtendStatusResponse,
  type ValidationErrorResponse,
} from "../types.js";
import { getStripe } from "../stripe.js";

const MAX_EXTEND_NIGHTS = 14;

/** Where guests land after paying on their phone; only used as the Stripe
 *  success/cancel redirect — the kiosk itself polls extend/status. */
const KIOSK_ORIGIN = process.env.KIOSK_ORIGIN ?? "http://localhost:5173";

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

function extendError(reply: FastifyReply, code: KioskExtendErrorCode, status = 409) {
  const body: KioskExtendErrorResponse = { error: code };
  return reply.status(status).send(body);
}

interface InHouseRow {
  booking_id: string;
  guest_name: string;
  room_name: string;
  bed_id: string;
  bed_label: string;
  nightly_rate: number;
  current_check_out: string;
  housekeeping_status: string;
}

const IN_HOUSE_SQL = `
  from bookings bk
  join guests g on g.id = bk.guest_id
  join booking_beds bb on bb.booking_id = bk.id and bb.is_active
  join beds bd on bd.id = bb.bed_id
  join rooms r on r.id = bd.room_id
`;

const IN_HOUSE_COLS = `
  bk.id as booking_id, g.full_name as guest_name, r.name as room_name,
  bd.id as bed_id, bd.label as bed_label, r.nightly_rate::float8 as nightly_rate,
  bd.housekeeping_status,
  upper(bb.stay)::text as current_check_out
`;

/** Consecutive nights the bed is free after `checkout` (capped at 14):
 *  nights until the next booking on that bed starts. */
async function freeNightsAfter(
  pool: Pool,
  bedId: string,
  checkout: string,
): Promise<number> {
  const result = await pool.query<{ free_nights: number }>(
    `
    select least($3, coalesce(min(lower(bb.stay)) - $2::date, $3))::int as free_nights
      from booking_beds bb
     where bb.bed_id = $1
       and bb.is_active
       and lower(bb.stay) >= $2::date
    `,
    [bedId, checkout, MAX_EXTEND_NIGHTS],
  );
  return result.rows[0].free_nights;
}

export function registerExtendRoutes(app: FastifyInstance, pool: Pool): void {
  app.post("/api/kiosk/extend/quote", async (request, reply) => {
    const parsed = kioskLookupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const { query } = parsed.data;
    const matches = await pool.query<InHouseRow>(
      `
      select ${IN_HOUSE_COLS}
      ${IN_HOUSE_SQL}
       where bk.status = 'checked_in'
         and bb.stay @> current_date
         and bd.housekeeping_status <> 'out_of_order'
         and (
               g.full_name ilike '%' || $1 || '%'
               or bk.id::text ilike $1 || '%'
             )
       order by g.full_name
       limit 5
      `,
      [query],
    );

    const results: KioskExtendQuoteResponse["results"] = [];
    for (const row of matches.rows) {
      results.push({
        bookingId: row.booking_id,
        reference: row.booking_id.slice(0, 8),
        guestName: row.guest_name,
        roomName: row.room_name,
        bedLabel: row.bed_label,
        currentCheckOut: row.current_check_out,
        nightlyRate: row.nightly_rate,
        currency: "USD",
        maxNights: await freeNightsAfter(pool, row.bed_id, row.current_check_out),
      });
    }

    const body: KioskExtendQuoteResponse = { results };
    return reply.status(200).send(body);
  });

  app.post("/api/kiosk/extend/checkout", async (request, reply) => {
    const parsed = kioskExtendCheckoutBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const { bookingId, nights } = parsed.data;

    const found = await pool.query<InHouseRow>(
      `
      select ${IN_HOUSE_COLS}
      ${IN_HOUSE_SQL}
       where bk.id = $1
      `,
      [bookingId],
    );
    if (found.rowCount === 0) {
      return extendError(reply, "not_found", 404);
    }
    const row = found.rows[0];

    const status = await pool.query<{ status: string; in_house: boolean }>(
      `
      select bk.status,
             (bb.stay @> current_date) as in_house
        from bookings bk
        join booking_beds bb on bb.booking_id = bk.id and bb.is_active
       where bk.id = $1
      `,
      [bookingId],
    );
    if (status.rows[0].status !== "checked_in" || !status.rows[0].in_house) {
      return extendError(reply, "not_in_house");
    }
    if (row.housekeeping_status === "out_of_order") {
      return extendError(reply, "bed_unavailable");
    }

    const maxNights = await freeNightsAfter(pool, row.bed_id, row.current_check_out);
    if (nights > maxNights) {
      return extendError(reply, "nights_exceeded");
    }

    const total = Math.round(row.nightly_rate * nights * 100) / 100;
    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(total * 100),
              product_data: {
                name: `Stay extension — ${nights} night${nights === 1 ? "" : "s"} @ $${row.nightly_rate.toFixed(2)}`,
              },
            },
          },
        ],
        metadata: {
          type: "stay_extension",
          bookingId,
          nights: String(nights),
        },
        success_url: `${KIOSK_ORIGIN}/kiosk?paid=1`,
        cancel_url: `${KIOSK_ORIGIN}/kiosk`,
      });

      const body: KioskExtendCheckoutResponse = {
        checkoutUrl: session.url ?? "",
        sessionId: session.id,
        amount: total,
        currency: "USD",
      };
      return reply.status(201).send(body);
    } catch (err) {
      request.log.error(err, "stripe checkout session creation failed");
      return extendError(reply, "stripe_unavailable", 503);
    }
  });

  app.get("/api/kiosk/extend/status", async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      const body: ValidationErrorResponse = {
        error: "validation_error",
        issues: [{ path: "sessionId", message: "sessionId is required" }],
      };
      return reply.status(400).send(body);
    }
    const applied = await pool.query(
      "select 1 from folio_line_items where external_ref = $1",
      [sessionId],
    );
    const body: KioskExtendStatusResponse = {
      status: (applied.rowCount ?? 0) > 0 ? "paid" : "pending",
    };
    return reply.status(200).send(body);
  });
}
