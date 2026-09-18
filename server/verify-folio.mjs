#!/usr/bin/env node
/**
 * server/verify-folio.mjs — verifies the folio ledger module end-to-end.
 *
 * Prereqs: `npm run dev` on :5173 and the API server on :3001, server/.env
 * with DATABASE_URL / STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.
 *
 * 1. Find-or-create a folio for a seeded booking; add two POS charges via
 *    POST /api/folios/:id/charges (Laundry 5.00, Airport transfer 25.00);
 *    GET folio -> balance 30.00.
 * 2. POST /api/folios/:id/checkout -> real Stripe URL; pay in Playwright
 *    (test card 4242…, top-level #cardNumber/#cardExpiry/#cardCvc).
 * 3. Self-sign checkout.session.completed (session retrieved via Stripe API)
 *    -> /api/webhooks/stripe -> 200; pg asserts: payment row −30.00 with
 *    external_ref=sessionId, folio_balances balance 0.00, replay idempotent.
 * 4. Realtime UI: open /folios/{id}, then run a second small payment
 *    end-to-end and assert the UI updates with NO page reload.
 * 5. Cleanup (folio + line items; the seeded booking stays). Screenshot:
 *    artifacts/folio.png
 */
import { createHmac, randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { config as loadEnv } from 'dotenv'
import { chromium } from 'playwright'
import pg from 'pg'

loadEnv({ path: 'server/.env', quiet: true })

const { DATABASE_URL, STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET } = process.env
if (!DATABASE_URL || !STRIPE_KEY || !WEBHOOK_SECRET) {
  console.error('DATABASE_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET must be set (server/.env)')
  process.exit(1)
}
const API = process.env.API_URL ?? 'http://127.0.0.1:3001'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

const results = []
function check(name, ok, detail = '') {
  results.push([name, ok])
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function stripePay(page, checkoutUrl) {
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('input#email').pressSequentially('folio-test@example.com', { delay: 15 })
  await page.locator('#cardNumber').pressSequentially('4242424242424242', { delay: 15 })
  await page.locator('#cardExpiry').pressSequentially('1234', { delay: 15 })
  await page.locator('#cardCvc').pressSequentially('123', { delay: 15 })
  const billingName = page.locator('#billingName')
  if (await billingName.isVisible().catch(() => false)) await billingName.fill('Folio Test')
  const zip = page.locator('#Field-postalCodeInput, #billingPostalCode')
  if (await zip.first().isVisible().catch(() => false)) await zip.first().fill('10001')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(/paid=1/, { timeout: 60000 })
}

async function retrieveSession(sessionId) {
  return (
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    })
  ).json()
}

function signedWebhook(session) {
  const payload = JSON.stringify({
    id: `evt_localdev_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: session },
  })
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')
  return fetch(`${API}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
    body: payload,
  })
}

const addCharge = (folioId, description, amount) =>
  fetch(`${API}/api/folios/${folioId}/charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, amount }),
  })

const getFolio = async (folioId) => (await fetch(`${API}/api/folios/${folioId}`)).json()

let folioId = ''
try {
  await mkdir('artifacts', { recursive: true })
  await client.connect()

  // --- seeded booking + find-or-create folio ---
  const booking = (
    await client.query(
      'select id, guest_id from bookings order by created_at limit 1',
    )
  ).rows[0]
  folioId =
    (await client.query('select id from folios where booking_id = $1 limit 1', [booking.id]))
      .rows[0]?.id ??
    (
      await client.query(
        "insert into folios (booking_id, guest_id, currency) values ($1, $2, 'USD') returning id",
        [booking.id, booking.guest_id],
      )
    ).rows[0].id
  console.log(`folio ${folioId.slice(0, 8)} for booking ${booking.id.slice(0, 8)}`)

  // --- charges + balance ---
  const c1 = await addCharge(folioId, 'Laundry', 5.0)
  const c2 = await addCharge(folioId, 'Airport transfer', 25.0)
  check('f1: two POS charges created (201)', c1.status === 201 && c2.status === 201)
  const folio1 = await getFolio(folioId)
  check(
    'f2: GET folio shows balance 30.00 with 2 items',
    folio1.balance === 30 && folio1.charges === 30 && folio1.items.length === 2,
    `balance=${folio1.balance} items=${folio1.items.length}`,
  )

  // --- checkout + pay ---
  const coRes = await fetch(`${API}/api/folios/${folioId}/checkout`, { method: 'POST' })
  const co = await coRes.json()
  check(
    'f3: checkout returns 201 with a real Stripe URL, amount 30',
    coRes.status === 201 && co.checkoutUrl?.startsWith('https://checkout.stripe.com') && co.amount === 30,
    `status=${coRes.status} amount=${co.amount}`,
  )

  const payBrowser = await chromium.launch()
  const payPage = await payBrowser.newPage()
  try {
    await stripePay(payPage, co.checkoutUrl)
    check('f4: Stripe test payment completed', true)
  } catch (err) {
    check('f4: Stripe test payment completed', false, String(err).split('\n')[0])
    await payPage.screenshot({ path: 'artifacts/folio-stripe-error.png' }).catch(() => {})
  }
  await payBrowser.close()

  const session = await retrieveSession(co.sessionId)
  check('f5: Stripe session is paid', session.payment_status === 'paid', session.payment_status)

  const hook1 = await signedWebhook(session)
  check('f6: folio_payment webhook accepted (200)', hook1.status === 200, `got ${hook1.status}`)

  const payRow = (
    await client.query(
      "select amount::float8 as amount, external_ref from folio_line_items where folio_id = $1 and type = 'payment'",
      [folioId],
    )
  ).rows
  check(
    'f7: payment line item −30.00 with external_ref = sessionId',
    payRow.length === 1 && payRow[0].amount === -30 && payRow[0].external_ref === co.sessionId,
    JSON.stringify(payRow),
  )
  const bal = (
    await client.query('select balance::float8 as b from folio_balances where folio_id = $1', [folioId])
  ).rows[0].b
  check('f8: folio_balances view returns 0.00', bal === 0, `balance=${bal}`)

  const hook2 = await signedWebhook(session)
  const payCount = (
    await client.query(
      "select count(*)::int as n from folio_line_items where folio_id = $1 and type = 'payment'",
      [folioId],
    )
  ).rows[0].n
  check('f9: replayed webhook idempotent (200, still 1 payment)', hook2.status === 200 && payCount === 1)

  // --- realtime UI check: no reload, second payment ---
  const uiBrowser = await chromium.launch()
  const page = await uiBrowser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(`${APP_URL}/folios/${folioId}`, { waitUntil: 'networkidle' })
    await page.getByText('Laundry').waitFor()
    check('f10: folio detail page renders line items', true)
    await page.waitForTimeout(2500) // let the realtime subscription establish

    // add a charge via API — UI must update without reload
    await addCharge(folioId, 'City tour', 12.0)
    await page.getByText('City tour').waitFor({ timeout: 15000 })
    await page.locator('text=$12.00').first().waitFor({ timeout: 15000 })
    check('f11: UI shows the new charge via realtime (no reload)', true)

    // pay it end-to-end
    const co2Res = await fetch(`${API}/api/folios/${folioId}/checkout`, { method: 'POST' })
    const co2 = await co2Res.json()
    const payBrowser2 = await chromium.launch()
    const payPage2 = await payBrowser2.newPage()
    await stripePay(payPage2, co2.checkoutUrl)
    await payBrowser2.close()
    const session2 = await retrieveSession(co2.sessionId)
    await signedWebhook(session2)

    // webhook -> realtime -> UI settles, still no reload
    await page.getByText('Settled — payment received, balance $0.00.').waitFor({ timeout: 15000 })
    check('f12: UI settles automatically after webhook (realtime)', true)
    await page.screenshot({ path: 'artifacts/folio.png', fullPage: true })
    console.log('screenshot: artifacts/folio.png')
  } catch (err) {
    check('f10-f12: folio UI realtime flow', false, String(err).split('\n')[0])
    await page.screenshot({ path: 'artifacts/folio.png', fullPage: true }).catch(() => {})
  } finally {
    await uiBrowser.close()
  }
} finally {
  if (folioId) {
    await client.query('delete from folios where id = $1', [folioId]).catch(() => {})
  }
  await client.end().catch(() => {})
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
