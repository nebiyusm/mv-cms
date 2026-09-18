-- Mad Vervet PMS — idempotency reference for folio line items
--
-- Stripe webhooks can be delivered more than once; external_ref (e.g. the
-- Stripe Checkout session id) makes payment-driven charges idempotent.

begin;

alter table folio_line_items
  add column external_ref text unique;

commit;
