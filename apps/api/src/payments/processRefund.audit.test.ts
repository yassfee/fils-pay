/**
 * FP-300 audit tests for the refund fee math (REF-7, REF-8) and the
 * refunded_fils <= captured_fils guard, against a real, migrated Postgres.
 * Transactions are set up through the real authorize/capture routes, so the
 * ledger state under test is the state capture actually produces.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("processRefund.audit.test.ts requires DATABASE_URL (a migrated Postgres)");

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

const approvingAcquirer: AcquirerSimulator = {
  authorize: () => Promise.reject(new Error("unused")),
  capture: () => Promise.reject(new Error("unused")),
  refund: (req) => Promise.resolve({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 }),
};

/** An approved merchant with an API key and a captured transaction of `amountFils`. */
async function capturedTransaction(mdrBps: number, discountBps: number, amountFils: number) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps) VALUES ($1, $2, $3) RETURNING id`,
    [`Refund Audit ${randomUUID()}`, mdrBps, discountBps],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "audit" });
  const headers = () => ({ authorization: `Bearer ${issued.rawKey}`, "idempotency-key": randomUUID() });

  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: headers(),
    payload: { amountFils, card: VALID_CARD, reference: "refund-audit" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  const cap = await app.inject({ method: "POST", url: `/v1/transactions/${transactionId}/capture`, headers: headers(), payload: {} });
  assert.equal(cap.statusCode, 200, cap.body);

  const key = await pool.query<{ id: string }>(`SELECT id FROM api_keys WHERE merchant_id = $1`, [merchantId]);
  const actor = { type: "merchant_api_key" as const, id: key.rows[0]!.id };
  return { merchantId, transactionId, actor };
}

/** Net (credits - debits) per account for one transaction. */
async function netByAccount(transactionId: string): Promise<Map<string, number>> {
  const rows = await pool.query<{ account_id: string; net: string }>(
    `SELECT account_id, SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text AS net
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY account_id`,
    [transactionId],
  );
  return new Map(rows.rows.map((r) => [r.account_id, Number(r.net)]));
}

test("REF-7: a full refund reverses the fee actually charged, net of the negotiated discount", async () => {
  // 10,000 fils at 250 bps = 250 fee; a 2,000 bps negotiated discount rebates 50, so F = 200.
  const { merchantId, transactionId, actor } = await capturedTransaction(250, 2_000, 10_000);
  assert.equal((await netByAccount(transactionId)).get("platform_fee_revenue"), 200);

  const result = await processRefund(pool, approvingAcquirer, {
    transactionId,
    merchantId,
    amountFils: toFils(10_000),
    idempotencyKey: randomUUID(),
    actor,
  });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal((result.body as { feeReversedFils: number }).feeReversedFils, 200);

  const net = await netByAccount(transactionId);
  assert.equal(net.get("platform_fee_revenue"), 0);
  assert.equal(net.get("merchant_payable"), 0);
  assert.equal(net.get("card_scheme_clearing"), 0);
});

test("REF-8: partial refunds round cumulatively, so their fee reversals sum to exactly the fee charged", async () => {
  // Design FP-300 §5 worked example: C = 10,000, F = 275; 3,333 + 3,333 + 3,334 -> 92 + 91 + 92 = 275.
  const { merchantId, transactionId, actor } = await capturedTransaction(275, 0, 10_000);
  assert.equal((await netByAccount(transactionId)).get("platform_fee_revenue"), 275);

  const fees: number[] = [];
  for (const amount of [3_333, 3_333, 3_334]) {
    const result = await processRefund(pool, approvingAcquirer, {
      transactionId,
      merchantId,
      amountFils: toFils(amount),
      idempotencyKey: randomUUID(),
      actor,
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    fees.push((result.body as { feeReversedFils: number }).feeReversedFils);
  }
  assert.deepEqual(fees, [92, 91, 92]);

  const net = await netByAccount(transactionId);
  assert.equal(net.get("platform_fee_revenue"), 0);
  assert.equal(net.get("merchant_payable"), 0);
  assert.equal(net.get("card_scheme_clearing"), 0);
});
