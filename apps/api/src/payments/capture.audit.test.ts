/**
 * FEES-3 (option A, decided 2026-10-30): the negotiated discount is taken off the MDR fee
 * (CHANGELOG 1.3.1 "applied after MDR"; 0047 "— y: off the fee, after MDR") inside
 * captureTransaction, so every capture entry point books the same net fee once. Before the
 * fix only the merchant capture route applied it, after commit; payment-link captures never did.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("capture.audit.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

async function discountedMerchant(mdrBps: number, discountBps: number) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`FEES-3 ${randomUUID()}`, mdrBps, discountBps],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "fees-3" });
  return { merchantId, auth: { authorization: `Bearer ${rawKey}` } };
}

/** Public checkout: POST /v1/payment-links/:token/pay (captureTransaction, actor 'system'). */
async function linkCapture(mdrBps: number, discountBps: number, amountFils: number) {
  const { merchantId, auth } = await discountedMerchant(mdrBps, discountBps);
  const link = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: auth,
    payload: { amountFils, reference: "fees-3", description: "FEES-3", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(link.statusCode, 201, link.body);
  const paid = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${link.json().token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD },
  });
  assert.equal(paid.statusCode, 200, paid.body);
  return paid.json().transactionId as string;
}

/** Merchant API: POST /v1/transactions then /:id/capture, sent twice with one key (the second is a replay). */
async function apiCapture(mdrBps: number, discountBps: number, amountFils: number) {
  const { auth } = await discountedMerchant(mdrBps, discountBps);
  const authz = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...auth, "idempotency-key": randomUUID() },
    payload: { amountFils, card: CARD, reference: "fees-3-api" },
  });
  assert.equal(authz.statusCode, 201, authz.body);
  const txnId = authz.json().id as string;
  const key = randomUUID();
  for (let i = 0; i < 2; i++) {
    const cap = await app.inject({ method: "POST", url: `/v1/transactions/${txnId}/capture`, headers: { ...auth, "idempotency-key": key }, payload: {} });
    assert.equal(cap.statusCode, 200, cap.body);
  }
  return txnId;
}

/** What the capture booked: ledger nets per account, discount legs, and feeFils on the webhook outbox row and the timeline. */
async function booked(transactionId: string) {
  const n = await pool.query<{ account_id: string; net: string }>(
    `SELECT account_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY account_id`,
    [transactionId],
  );
  const nets = Object.fromEntries(n.rows.map((x) => [x.account_id, Number(x.net)]));
  const legs = await pool.query(
    `SELECT 1 FROM ledger_entries WHERE transaction_id = $1 AND description = 'capture: negotiated discount adjustment'`,
    [transactionId],
  );
  const o = await pool.query<{ fee: string }>(
    `SELECT payload->>'feeFils' AS fee FROM outbox_events WHERE event_type = 'transaction.captured' AND aggregate_id = $1`,
    [transactionId],
  );
  const e = await pool.query<{ fee: string }>(
    `SELECT metadata->>'feeFils' AS fee FROM transaction_events WHERE transaction_id = $1 AND event_type = 'captured'`,
    [transactionId],
  );
  return {
    fee: nets.platform_fee_revenue,
    merchantPayable: nets.merchant_payable,
    discountLegs: legs.rowCount,
    outboxFeeFils: o.rows.map((x) => Number(x.fee)),
    timelineFeeFils: e.rows.map((x) => Number(x.fee)),
  };
}

// Delta Marketplace terms. fee = applyRateFils(100,000, 275) = 2,750; discount = applyRateFils(2,750, 1250) = 344; net 2,406.
test("FEES-3: a payment-link capture books the negotiated discount (fee 2,406 net, not 2,750)", async () => {
  assert.deepEqual(await booked(await linkCapture(275, 1250, 100_000)), {
    fee: 2_406,
    merchantPayable: 97_594,
    discountLegs: 2,
    outboxFeeFils: [2_406],
    timelineFeeFils: [2_406],
  });
});

test("FEES-3: the merchant capture route books exactly one discount leg pair, even on a replayed capture", async () => {
  assert.deepEqual(await booked(await apiCapture(275, 1250, 100_000)), {
    fee: 2_406,
    merchantPayable: 97_594,
    discountLegs: 2,
    outboxFeeFils: [2_406],
    timelineFeeFils: [2_406],
  });
});

// Invariant vector (FEES-3/FEES-5): 12,345 at 250 bps = 308.625 -> 309 (half-to-even), 15% of 309 = 46.35 -> 46, net 263.
// Before the fix the link path booked 309; Go's amount-first formula gave 262. All paths must give 263.
test("FEES-3: 12,345 fils at 250 bps with a 1500 bps discount books 263 via link capture and via API capture", async () => {
  const want = { fee: 263, merchantPayable: 12_082, discountLegs: 2, outboxFeeFils: [263], timelineFeeFils: [263] };
  assert.deepEqual(await booked(await linkCapture(250, 1500, 12_345)), want);
  assert.deepEqual(await booked(await apiCapture(250, 1500, 12_345)), want);
});
