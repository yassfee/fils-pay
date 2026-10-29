/**
 * REC-1 + FP-300 box 5 (reconciliation): GET /v1/settlement/reconciliation must tie out to 0 fils
 * with refunds unbatched (pending line) and netted into a paid batch, and must flag reservations
 * with no completed refund instead of hiding them. Real, migrated Postgres; money is integer fils.
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
if (!databaseUrl) throw new Error("settlement.refunds.audit.test.ts requires DATABASE_URL (a migrated Postgres)");
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
// Today's Asia/Bahrain business day (UTC+3, no DST) and the next one.
const DAY = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const NEXT = new Date(Date.parse(`${DAY}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function merchant() {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Recon Refund ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "recon" });
  const post = async (url: string, payload: object) => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
      payload,
    });
    assert.ok(res.statusCode < 300, `${url}: ${res.statusCode} ${res.body}`);
    return res.json() as { id: string; feeReversedFils: number };
  };
  const captureAndRefund = async (amountFils: number, refundFils: number) => {
    const txn = await post("/v1/transactions", { amountFils, card: VALID_CARD, reference: "recon" });
    await post(`/v1/transactions/${txn.id}/capture`, {});
    const refund = await post("/v1/refunds", { transactionId: txn.id, amountFils: refundFils });
    return { transactionId: txn.id, refund };
  };
  const recon = async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/settlement/reconciliation?from=${DAY}&to=${NEXT}`,
      headers: { authorization: `Bearer ${rawKey}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as Record<string, unknown> & { gapFils: number; reservedNotCompleted: Array<Record<string, unknown>> };
  };
  return { merchantId, captureAndRefund, recon };
}

test("REC-1/FP-300: an unbatched capture (integer fee, 4,740 at 250 bps) and an unbatched refund tie out to 0", async () => {
  const m = await merchant();
  const { refund } = await m.captureAndRefund(4_740, 2_000); // ledger fee 118 (half-to-even); float estimate gave 119
  const r = await m.recon();
  assert.equal(r.pendingUnbatchedFils, 4_740 - 118);
  assert.equal(r.pendingUnbatchedRefundsFils, -(2_000 - refund.feeReversedFils));
  assert.equal(r.gapFils, 0, JSON.stringify(r));
  assert.equal(r.explained, true);
});

test("REC-1/FP-300: a refund netted into a closed and paid batch (payout posted inside the window) ties out to 0", async () => {
  const m = await merchant();
  const { refund } = await m.captureAndRefund(10_000, 4_000);
  const f = refund.feeReversedFils; // 100
  const net = 10_000 - 250 - (4_000 - f);
  // The batch CloseBatch (batch.go) + PayoutBatch would write: totals, stamped event and refund, payout legs at now().
  const b = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils,
                                     refund_gross_fils, refund_fee_reversed_fils, closed_at, paid_at)
     VALUES ($1, $2, 'paid', 10000, 250, $3, 4000, $4, now(), now()) RETURNING id`,
    [m.merchantId, DAY, net, f],
  );
  const batchId = b.rows[0]!.id;
  await pool.query(
    `UPDATE transaction_events SET settlement_batch_id = $2
      WHERE event_type IN ('captured', 'partially_captured')
        AND transaction_id IN (SELECT id FROM transactions WHERE merchant_id = $1)`,
    [m.merchantId, batchId],
  );
  await pool.query(`UPDATE refunds SET settlement_batch_id = $2 WHERE merchant_id = $1`, [m.merchantId, batchId]);
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'merchant_payable', 'debit',  $3, now(), 'settlement payout: batch paid'),
            ($1, $2, 'platform_cash',    'credit', $3, now(), 'settlement payout: batch paid')`,
    [randomUUID(), m.merchantId, net],
  );
  const r = await m.recon();
  assert.equal(r.settlementNetPayoutFils, net);
  assert.equal(r.nettedRefundsFils, -(4_000 - f));
  assert.equal(r.pendingUnbatchedFils, 0);
  assert.equal(r.pendingUnbatchedRefundsFils, 0);
  assert.equal(r.gapFils, 0, JSON.stringify(r));
});

test("FP-300: a reservation with no completed refund is flagged in its own list, not hidden in the gap", async () => {
  const m = await merchant();
  const { transactionId } = await m.captureAndRefund(10_000, 1_000);
  // A phase-2 crash leaves refunded_fils raised with no refunds row (design §4.5).
  await pool.query(`UPDATE transactions SET refunded_fils = refunded_fils + 2000 WHERE id = $1`, [transactionId]);
  const r = await m.recon();
  assert.deepEqual(r.reservedNotCompleted, [{ transactionId, refundedFils: 3_000, succeededRefundsFils: 1_000 }]);
  assert.equal(r.gapFils, 0, JSON.stringify(r));
});
