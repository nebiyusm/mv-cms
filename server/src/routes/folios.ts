import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z, type ZodError } from "zod";
import {
  addFolioChargeBodySchema,
  type FolioDetailResponse,
  type FolioErrorCode,
  type FolioErrorResponse,
  type FolioLineItem,
  type FolioListResponse,
  type FolioCheckoutResponse,
  type ValidationErrorResponse,
} from "../types.js";
import { getStripe } from "../stripe.js";

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

function folioError(reply: FastifyReply, code: FolioErrorCode, status = 409) {
  const body: FolioErrorResponse = { error: code };
  return reply.status(status).send(body);
}

const foliosQuerySchema = z.object({
  propertyCode: z.enum(["ADD", "NBO"]).optional(),
});

interface BalanceRow {
  folio_id: string;
  booking_id: string | null;
  status: "open" | "closed";
  currency: string;
  charges: string | number;
  payments: string | number;
  balance: string | number;
  guest_name: string;
}

function toSummary(row: BalanceRow) {
  return {
    folioId: row.folio_id,
    bookingId: row.booking_id,
    reference: row.booking_id ? row.booking_id.slice(0, 8) : null,
    guestName: row.guest_name,
    status: row.status,
    currency: row.currency,
    charges: Number(row.charges),
    payments: Number(row.payments),
    balance: Number(row.balance),
  };
}

const BALANCE_JOIN = `
  from folio_balances fb
  join guests g on g.id = fb.guest_id
`;

async function fetchBalance(
  db: Pick<Pool, "query"> | PoolClient,
  folioId: string,
): Promise<BalanceRow | null> {
  const result = await db.query<BalanceRow>(
    `select fb.*, g.full_name as guest_name ${BALANCE_JOIN} where fb.folio_id = $1`,
    [folioId],
  );
  return result.rows[0] ?? null;
}

export function registerFolioRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/folios", async (request, reply) => {
    const parsed = foliosQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }
    const { propertyCode } = parsed.data;

    // Property scoping goes bookings -> booking_beds -> beds -> rooms.
    // Folios without a booking (walk-up POS only) are listed for every property.
    const result = await pool.query<BalanceRow>(
      `
      select fb.*, g.full_name as guest_name
      ${BALANCE_JOIN}
       where fb.status = 'open'
         and (
               $1::text is null
               or not exists (select 1 from booking_beds bb where bb.booking_id = fb.booking_id)
               or exists (
                    select 1
                      from booking_beds bb
                      join beds bd on bd.id = bb.bed_id
                      join rooms r on r.id = bd.room_id
                      join properties p on p.id = r.property_id
                     where bb.booking_id = fb.booking_id
                       and p.code = $1
                  )
             )
       order by g.full_name
      `,
      [propertyCode ?? null],
    );

    const body: FolioListResponse = { folios: result.rows.map(toSummary) };
    return reply.status(200).send(body);
  });

  app.get("/api/folios/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return folioError(reply, "not_found", 404);
    }

    const row = await fetchBalance(pool, id);
    if (!row) {
      return folioError(reply, "not_found", 404);
    }

    const items = await pool.query<{
      id: string;
      type: FolioLineItem["type"];
      description: string;
      amount: string | number;
      created_at: string;
      external_ref: string | null;
    }>(
      `
      select id, type, description, amount, created_at, external_ref
        from folio_line_items
       where folio_id = $1
       order by created_at desc, id desc
      `,
      [id],
    );

    const body: FolioDetailResponse = {
      ...toSummary(row),
      items: items.rows.map((item) => ({
        id: item.id,
        type: item.type,
        description: item.description,
        amount: Number(item.amount),
        createdAt: item.created_at,
        externalRef: item.external_ref,
      })),
    };
    return reply.status(200).send(body);
  });

  app.post("/api/folios/:id/charges", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return folioError(reply, "not_found", 404);
    }

    const parsed = addFolioChargeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, parsed.error);
    }

    const folio = await pool.query<{ status: string }>(
      "select status from folios where id = $1",
      [id],
    );
    if (folio.rowCount === 0) {
      return folioError(reply, "not_found", 404);
    }
    if (folio.rows[0].status !== "open") {
      return folioError(reply, "folio_closed");
    }

    const inserted = await pool.query<{
      id: string;
      type: FolioLineItem["type"];
      description: string;
      amount: string | number;
      created_at: string;
      external_ref: string | null;
    }>(
      `
      insert into folio_line_items (folio_id, type, description, amount)
      values ($1, 'pos', $2, $3)
      returning id, type, description, amount, created_at, external_ref
      `,
      [id, parsed.data.description, parsed.data.amount],
    );

    const row = inserted.rows[0];
    const body: FolioLineItem = {
      id: row.id,
      type: row.type,
      description: row.description,
      amount: Number(row.amount),
      createdAt: row.created_at,
      externalRef: row.external_ref,
    };
    return reply.status(201).send(body);
  });

  app.post("/api/folios/:id/checkout", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) {
      return folioError(reply, "not_found", 404);
    }

    const row = await fetchBalance(pool, id);
    if (!row) {
      return folioError(reply, "not_found", 404);
    }
    if (row.status !== "open") {
      return folioError(reply, "folio_closed");
    }

    const balance = Number(row.balance);
    if (balance <= 0) {
      return folioError(reply, "nothing_to_pay");
    }

    try {
      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(balance * 100),
              product_data: { name: `Folio balance — ${row.guest_name}` },
            },
          },
        ],
        metadata: { type: "folio_payment", folioId: id },
        success_url: `${KIOSK_ORIGIN}/folios/${id}?paid=1`,
        cancel_url: `${KIOSK_ORIGIN}/folios/${id}`,
      });

      const body: FolioCheckoutResponse = {
        checkoutUrl: session.url ?? "",
        sessionId: session.id,
        amount: balance,
      };
      return reply.status(201).send(body);
    } catch (err) {
      request.log.error(err, "stripe checkout session creation failed");
      return folioError(reply, "stripe_unavailable", 503);
    }
  });
}
