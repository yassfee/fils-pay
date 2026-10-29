/**
 * FP-300 box 5 (reports): refund.succeeded outbox events roll up into
 * merchant_daily_volume on the Asia/Bahrain business day (case file: the day
 * runs midnight to midnight Asia/Bahrain, UTC+3). Real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { applyEvent } from "./applyEvent.js";
import { REPORTING_EVENT_TYPES, runConsumerPass } from "./runConsumerPass.js";
import { enqueueEvent } from "@filspay/events";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("refundRollup.audit.test.ts requires DATABASE_URL (a migrated Postgres)");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

test("FP-300: refund.succeeded at 2026-10-29T22:30Z is consumed and lands on Bahrain day 2026-10-30", async () => {
  assert.ok(REPORTING_EVENT_TYPES.includes("refund.succeeded"), "the consumer must select refund.succeeded");
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 275) RETURNING id`,
    [`Refund Rollup ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  for (const amountFils of [3_333, 1_000]) {
    await withTransaction(pool, (client) =>
      applyEvent(client, {
        id: 1,
        aggregate_id: randomUUID(),
        event_type: "refund.succeeded",
        created_at: new Date("2026-10-29T22:30:00Z"),
        payload: { merchantId, refundId: randomUUID(), amountFils, feeReversedFils: 92, refundedTotalFils: amountFils, newStatus: "partially_refunded" },
      } as Parameters<typeof applyEvent>[1]),
    );
  }
  const rows = await pool.query<{ volume_date: string; refund_count: number; refund_gross_fils: string }>(
    `SELECT to_char(volume_date, 'YYYY-MM-DD') AS volume_date, refund_count, refund_gross_fils::text
       FROM merchant_daily_volume WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.deepEqual(
    rows.rows.map((r) => [r.volume_date, r.refund_count, Number(r.refund_gross_fils)]),
    [["2026-10-30", 2, 4_333]],
  );
});

test("FP-300: the same refund.succeeded outbox event consumed by repeated passes is counted once", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 275) RETURNING id`,
    [`Refund Replay ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await enqueueEvent(pool, {
    eventType: "refund.succeeded",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, refundId: randomUUID(), amountFils: 2_500, feeReversedFils: 69, refundedTotalFils: 2_500, newStatus: "partially_refunded" },
  });
  // Drain the shared backlog, then run two more (now empty) passes over the same watermark.
  while ((await runConsumerPass(pool, { consumerBatchLimit: 500 })).processedCount > 0);
  await runConsumerPass(pool, { consumerBatchLimit: 500 });
  await Promise.all([runConsumerPass(pool, { consumerBatchLimit: 500 }), runConsumerPass(pool, { consumerBatchLimit: 500 })]);
  const rows = await pool.query<{ refund_count: number; refund_gross_fils: string }>(
    `SELECT refund_count, refund_gross_fils::text FROM merchant_daily_volume WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.deepEqual(rows.rows.map((r) => [r.refund_count, Number(r.refund_gross_fils)]), [[1, 2_500]]);
});
