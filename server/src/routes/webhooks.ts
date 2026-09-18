import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { getStripe } from "../stripe.js";

/**
 * Stripe webhook endpoint. Registered in an encapsulated context so the
 * application/json parser can be overridden to hand us the RAW body —
 * Stripe's signature is computed over the exact bytes received.
 */
export function registerWebhookRoutes(app: FastifyInstance, pool: Pool): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    scope.post("/api/webhooks/stripe", async (request, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      const signature = request.headers["stripe-signature"];
      if (!secret || typeof signature !== "string") {
        return reply.status(400).send({ error: "bad_signature" });
      }

      let event;
      try {
        event = getStripe().webhooks.constructEvent(
          request.body as Buffer,
          signature,
          secret,
        );
      } catch (err) {
        request.log.warn(err, "stripe webhook signature verification failed");
        return reply.status(400).send({ error: "bad_signature" });
      }

      if (event.type !== "checkout.session.completed") {
        return reply.send({ received: true });
      }
      const session = event.data.object;

      // Folio balance payment: a single negative payment line item.
      if (session.metadata?.type === "folio_payment") {
        const folioId = session.metadata.folioId;
        const total = (session.amount_total ?? 0) / 100;
        if (!folioId || total <= 0) {
          request.log.warn({ metadata: session.metadata }, "folio_payment webhook with bad metadata");
          return reply.status(400).send({ error: "bad_metadata" });
        }

        const client = await pool.connect();
        try {
          const existing = await client.query(
            "select 1 from folio_line_items where external_ref = $1",
            [session.id],
          );
          if ((existing.rowCount ?? 0) > 0) {
            return reply.send({ received: true, duplicate: true });
          }

          const folio = await client.query("select id from folios where id = $1", [folioId]);
          if (folio.rowCount === 0) {
            return reply.status(404).send({ error: "not_found" });
          }

          await client.query(
            "insert into folio_line_items (folio_id, type, description, amount, external_ref) values ($1, 'payment', 'Stripe Checkout payment', $2, $3)",
            [folioId, -total, session.id],
          );
          request.log.info({ folioId, sessionId: session.id }, "folio payment applied");
          return reply.send({ received: true });
        } catch (err) {
          if ((err as { code?: string }).code === "23505") {
            // unique violation on external_ref — already applied
            return reply.send({ received: true, duplicate: true });
          }
          throw err;
        } finally {
          client.release();
        }
      }

      if (session.metadata?.type !== "stay_extension") {
        return reply.send({ received: true });
      }

      const bookingId = session.metadata.bookingId;
      const nights = Number.parseInt(session.metadata.nights ?? "", 10);
      const total = (session.amount_total ?? 0) / 100;
      if (!bookingId || !Number.isInteger(nights) || nights < 1) {
        request.log.warn({ metadata: session.metadata }, "stay_extension webhook with bad metadata");
        return reply.status(400).send({ error: "bad_metadata" });
      }

      const client = await pool.connect();
      try {
        await client.query("begin");

        // Idempotency: the extension charge for this session already applied.
        const existing = await client.query(
          "select 1 from folio_line_items where external_ref = $1",
          [session.id],
        );
        if ((existing.rowCount ?? 0) > 0) {
          await client.query("rollback");
          return reply.send({ received: true, duplicate: true });
        }

        const booking = await client.query<{ id: string; guest_id: string; status: string }>(
          "select id, guest_id, status from bookings where id = $1 for update",
          [bookingId],
        );
        if (booking.rowCount === 0 || booking.rows[0].status !== "checked_in") {
          await client.query("rollback");
          return reply.status(409).send({ error: "not_in_house" });
        }

        // Extend the active stay; the EXCLUDE constraint on (bed_id, stay)
        // throws 23P01 if someone took the bed in the meantime.
        await client.query(
          "update booking_beds set stay = daterange(lower(stay), upper(stay) + $2::int) where booking_id = $1 and is_active",
          [bookingId, nights],
        );

        let folioId = (
          await client.query<{ id: string }>(
            "select id from folios where booking_id = $1 limit 1",
            [bookingId],
          )
        ).rows[0]?.id;
        if (!folioId) {
          folioId = (
            await client.query<{ id: string }>(
              "insert into folios (booking_id, guest_id, currency) values ($1, $2, 'USD') returning id",
              [bookingId, booking.rows[0].guest_id],
            )
          ).rows[0].id;
        }

        await client.query(
          "insert into folio_line_items (folio_id, type, description, amount, external_ref) values ($1, 'extension', $2, $3, $4)",
          [folioId, `Stay extension: ${nights} nights`, total, session.id],
        );
        await client.query(
          "insert into folio_line_items (folio_id, type, description, amount, external_ref) values ($1, 'payment', 'Stripe Checkout payment', $2, $3)",
          [folioId, -total, `${session.id}:payment`],
        );

        await client.query("commit");
        request.log.info({ bookingId, nights, sessionId: session.id }, "stay extension applied");
        return reply.send({ received: true });
      } catch (err) {
        await client.query("rollback");
        const code = (err as { code?: string }).code;
        if (code === "23505") {
          // unique violation on external_ref — already applied, treat as success
          return reply.send({ received: true, duplicate: true });
        }
        if (code === "23P01") {
          console.error(
            `STAY EXTENSION CONFLICT: bed no longer free for booking ${bookingId} (+${nights} nights, session ${session.id}) — returning 500 so Stripe retries`,
          );
          return reply.status(500).send({ error: "conflict_retry" });
        }
        throw err;
      } finally {
        client.release();
      }
    });
  });
}
