/**
 * FP-300 route-level tests for POST /v1/refunds (design docs/audit/FP-300-refunds.md §3-§5, §9 T1-T4),
 * via app.inject against a real, migrated Postgres. Transactions are created through the real
 * authorize/capture routes; the simulator acquirer approves (ACQUIRER_FAILURE_RATE=0).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("refunds.audit.test.ts requires DATABASE_URL (a migrated Postgres)");

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

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

/** An approved merchant (API key) with one captured transaction of `amountFils`. */
async function capturedTransaction(amountFils: number, mdrBps = 275) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Refund Route ${randomUUID()}`, mdrBps],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "refund-route" });
  const headers = { authorization: `Bearer ${rawKey}` };

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "refund-route" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${transactionId}/capture`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {},
  });
  assert.equal(cap.statusCode, 200, cap.body);
  return { merchantId, headers, transactionId };
}

function refund(headers: Record<string, string>, payload: unknown, key: string | null = randomUUID()) {
  return app.inject({
    method: "POST",
    url: "/v1/refunds",
    headers: key === null ? headers : { ...headers, "idempotency-key": key },
    payload: payload as object,
  });
}

/** Row counts the refund writes, for one transaction. */
async function writes(transactionId: string) {
  const r = await pool.query<{ refunds: string; legs: string; events: string; outbox: string; refunded: string }>(
    `SELECT (SELECT count(*) FROM refunds WHERE transaction_id = $1) AS refunds,
            (SELECT count(*) FROM ledger_entries WHERE transaction_id = $1 AND description LIKE 'refund:%') AS legs,
            (SELECT count(*) FROM transaction_events WHERE transaction_id = $1 AND event_type IN ('refund_partial', 'refunded')) AS events,
            (SELECT count(*) FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'refund.succeeded') AS outbox,
            (SELECT refunded_fils FROM transactions WHERE id = $1)::text AS refunded`,
    [transactionId],
  );
  return r.rows[0]!;
}

test("FP-300 (a): 3,333 + 3,333 + 3,334 of 10,000 refunds in full, fee reversals sum to F, every account nets to 0", async () => {
  const { headers, transactionId } = await capturedTransaction(10_000);
  const fee = await pool.query<{ f: string }>(
    `SELECT SUM(amount_fils)::text AS f FROM ledger_entries
      WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue' AND direction = 'credit'`,
    [transactionId],
  );
  const F = Number(fee.rows[0]!.f);
  assert.equal(F, 275);

  const statuses: string[] = [];
  let feeReversed = 0;
  for (const amountFils of [3_333, 3_333, 3_334]) {
    const res = await refund(headers, { transactionId, amountFils, reason: "customer_request" });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { amountFils: number; feeReversedFils: number; transactionStatus: string };
    assert.equal(body.amountFils, amountFils);
    statuses.push(body.transactionStatus);
    feeReversed += body.feeReversedFils;
  }
  assert.deepEqual(statuses, ["partially_refunded", "partially_refunded", "refunded"]);
  assert.equal(feeReversed, F);

  const net = await pool.query<{ account_id: string; net: string }>(
    `SELECT account_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY account_id`,
    [transactionId],
  );
  for (const account of ["merchant_payable", "platform_fee_revenue", "card_scheme_clearing"]) {
    assert.equal(Number(net.rows.find((r) => r.account_id === account)?.net), 0, account);
  }

  const events = await pool.query<{ event_type: string; amount_fils: string }>(
    `SELECT event_type, amount_fils::text FROM transaction_events
      WHERE transaction_id = $1 AND event_type IN ('refund_partial', 'refunded') ORDER BY occurred_at, id`,
    [transactionId],
  );
  assert.deepEqual(
    events.rows.map((e) => [e.event_type, Number(e.amount_fils)]),
    [["refund_partial", -3_333], ["refund_partial", -3_333], ["refunded", -3_334]],
  );
  const w = await writes(transactionId);
  assert.equal(Number(w.outbox), 3);
  assert.equal(Number(w.refunds), 3);
  assert.equal(Number(w.refunded), 10_000);
});

test("FP-300 (b): the same key and body replays the identical response and writes nothing new", async () => {
  const { headers, transactionId } = await capturedTransaction(10_000);
  const key = randomUUID();
  const first = await refund(headers, { transactionId, amountFils: 4_000 }, key);
  assert.equal(first.statusCode, 200, first.body);
  const before = await writes(transactionId);

  const replay = await refund(headers, { transactionId, amountFils: 4_000 }, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  assert.deepEqual(await writes(transactionId), before);
});

test("FP-300 (c): a refund above the refundable amount is refused with 422 and moves nothing", async () => {
  const { headers, transactionId } = await capturedTransaction(10_000);
  assert.equal((await refund(headers, { transactionId, amountFils: 6_000 })).statusCode, 200);
  const before = await writes(transactionId);
  const res = await refund(headers, { transactionId, amountFils: 4_001 });
  assert.equal(res.statusCode, 422, res.body);
  assert.deepEqual(await writes(transactionId), before);
});

test("FP-300 (d): merchant A cannot refund merchant B's transaction (404) nor name a merchant in the body (400)", async () => {
  const a = await capturedTransaction(10_000);
  const b = await capturedTransaction(10_000);
  const res = await refund(a.headers, { transactionId: b.transactionId, amountFils: 1_000 });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error, "transaction_not_found");

  const spoof = await refund(a.headers, { transactionId: b.transactionId, amountFils: 1_000, merchantId: b.merchantId });
  assert.equal(spoof.statusCode, 400, spoof.body);
  assert.equal(spoof.json().error, "invalid_request");
  assert.equal(Number((await writes(b.transactionId)).refunded), 0);
});

test("FP-300 (e): a support-role session is 403 and a pending (pre-OTP) owner session is 401", async () => {
  const { merchantId, transactionId } = await capturedTransaction(10_000);
  async function sessionCookie(role: string, authenticated: boolean) {
    const u = await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, $3, 'unused') RETURNING id`,
      [merchantId, `${role}-${randomUUID()}@example.test`, role],
    );
    const raw = randomToken(32);
    await pool.query(
      `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at)
       VALUES ($1, $2, $3, now() + interval '10 minutes')`,
      [u.rows[0]!.id, sha256Hex(raw), authenticated],
    );
    return { cookie: `${config.cookieName}=${raw}` };
  }
  const support = await refund(await sessionCookie("support", true), { transactionId, amountFils: 1_000 });
  assert.equal(support.statusCode, 403, support.body);
  const pending = await refund(await sessionCookie("owner", false), { transactionId, amountFils: 1_000 });
  assert.equal(pending.statusCode, 401, pending.body);
  assert.equal(Number((await writes(transactionId)).refunded), 0);
});

test("FP-300 (f): a missing Idempotency-Key is 400 idempotency_key_required", async () => {
  const { headers, transactionId } = await capturedTransaction(10_000);
  const res = await refund(headers, { transactionId, amountFils: 1_000 }, null);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error, "idempotency_key_required");
});

test("FP-300 (g): two concurrent refunds whose sum exceeds the capture: exactly one succeeds", async () => {
  const { headers, transactionId } = await capturedTransaction(10_000);
  const results = await Promise.all([
    refund(headers, { transactionId, amountFils: 6_000 }),
    refund(headers, { transactionId, amountFils: 6_000 }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 422], results.map((r) => r.body).join(" | "));
  const w = await writes(transactionId);
  assert.equal(Number(w.refunded), 6_000);
  assert.equal(Number(w.refunds), 1);
  assert.equal(Number(w.outbox), 1);
});
