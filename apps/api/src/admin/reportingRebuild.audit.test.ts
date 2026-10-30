/**
 * RBD-1: the admin "Rebuild analytics" button (POST /v1/admin/reporting/rebuild, refreshAnalyticsRollups) refilled
 * the rollups from the source tables but left the reporting worker's watermark behind, so the worker then applied
 * its backlog on top (double counts), and it never wrote the FP-300 refund columns (refunds wiped).
 * Acceptance: rebuild, then one worker pass, leaves the rollups unchanged and the refund columns intact.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";
import { refreshAnalyticsRollups } from "./reportingRebuild.js";
import { runConsumerPass } from "../../../reporting/src/consumer/runConsumerPass.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("reportingRebuild.audit.test.ts requires DATABASE_URL");
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
test.after(async () => {
  await pool.end();
});

async function rollup(merchantId: string) {
  const r = await pool.query(
    `SELECT captured_count, captured_gross_fils::int AS gross, voided_count, refund_count, refund_gross_fils::int AS refunds
       FROM merchant_daily_volume WHERE merchant_id = $1`,
    [merchantId],
  );
  return r.rows;
}

test("RBD-1: rebuild, then one worker pass, leaves the rollups unchanged and the refund columns intact", async () => {
  for (let i = 0; i < 20 && (await runConsumerPass(pool, { consumerBatchLimit: 500 })).processedCount > 0; i++);
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [`RBD-1 ${randomUUID()}`]);
  const merchantId = m.rows[0]!.id;
  // A capture and a refund the API journaled and enqueued, not yet consumed by the worker (its backlog).
  await withTransaction(pool, async (client) => {
    const t = await client.query<{ id: string }>(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'partially_refunded', 10000, 10000, 1500, $2, now()) RETURNING id`,
      [merchantId, `acq-${randomUUID()}`],
    );
    const txnId = t.rows[0]!.id;
    await client.query(
      `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at) VALUES ($1, 'captured', 10000, 'system', now())`,
      [txnId],
    );
    await enqueueEvent(client, {
      eventType: "transaction.captured",
      aggregateType: "transaction",
      aggregateId: txnId,
      payload: { merchantId, amountCapturedFils: 10_000, feeFils: 250, newStatus: "captured", capturedTotalFils: 10_000 },
    });
    const r = await client.query<{ id: string }>(
      `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status, acquirer_reference, created_by_type, created_by_id)
       VALUES ($1, $2, 1500, 37, 'succeeded', $3, 'merchant_session', $4) RETURNING id`,
      [txnId, merchantId, `rf-${randomUUID()}`, randomUUID()],
    );
    await enqueueEvent(client, {
      eventType: "refund.succeeded",
      aggregateType: "transaction",
      aggregateId: txnId,
      payload: { merchantId, refundId: r.rows[0]!.id, amountFils: 1_500, feeReversedFils: 37 },
    });
  });

  let summary: { volumeRows: number; trendRows: number } | undefined;
  for (let attempt = 0; attempt < 5 && !summary; attempt++) {
    // 409 reporting_rebuild_busy only while some other transaction on the cluster straddles the snapshot; retry.
    summary = await withTransaction(pool, (client) => refreshAnalyticsRollups(client)).catch((err: { statusCode?: number }) => {
      if (err.statusCode !== 409) throw err;
      return undefined;
    });
  }
  assert.ok(summary && summary.volumeRows >= 1, "synchronous {volumeRows, trendRows} response");
  const afterRebuild = await rollup(merchantId);
  assert.deepEqual(afterRebuild, [{ captured_count: 1, gross: 10_000, voided_count: 0, refund_count: 1, refunds: 1_500 }]);

  await runConsumerPass(pool, { consumerBatchLimit: 500 });
  assert.deepEqual(await rollup(merchantId), afterRebuild, "the worker must not re-apply what the rebuild covered");
});
