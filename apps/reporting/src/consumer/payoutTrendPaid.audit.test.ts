import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { withTransaction } from "../db/withTransaction.js";
import { applyEvent, type OutboxEventRow } from "./applyEvent.js";
import { REPORTING_EVENT_TYPES } from "./runConsumerPass.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("payoutTrendPaid.audit.test.ts requires DATABASE_URL (a migrated Postgres)");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
test.after(async () => {
  await pool.end();
});

// HUNT-3: merchant_payout_trends copies the batch status once, at settlement.batch_closed. The batch is paid
// later (MarkBatchPaid), and nothing refreshed the row, so the dashboard's payout table showed "closed" with
// no paid date for a payout that had gone out.
test("HUNT-3: a batch paid after its close event shows as paid, with its paid date, in payout trends", async () => {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`Trend ${randomUUID()}`]);
  const merchantId = m.rows[0]!.id;
  const b = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
     VALUES ($1, '2026-01-05', 'closed', 10000, 250, 9750, now()) RETURNING id`,
    [merchantId],
  );
  const batchId = b.rows[0]!.id;
  const row = (event_type: string, payload: Record<string, unknown>): OutboxEventRow =>
    ({ id: 1, event_type, aggregate_id: batchId, payload, created_at: new Date("2026-01-06T10:00:00Z") });

  await withTransaction(pool, (client) =>
    applyEvent(client, row("settlement.batch_closed", { merchantId, batchId, batchDate: "2026-01-05", grossFils: 10000, feeFils: 250, netPayoutFils: 9750 })),
  );
  const paid = await pool.query<{ paid_at: Date }>(`UPDATE settlement_batches SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING paid_at`, [batchId]);

  assert.ok(REPORTING_EVENT_TYPES.includes("settlement.paid"), "the consumer must read settlement.paid events");
  await withTransaction(pool, (client) =>
    applyEvent(client, row("settlement.paid", { merchantId, batchId, batchDate: "2026-01-05", netPayoutFils: 9750 })),
  );
  const trend = await pool.query<{ status: string; paid_at: Date | null }>(
    `SELECT status, paid_at FROM merchant_payout_trends WHERE settlement_batch_id = $1`,
    [batchId],
  );
  assert.equal(trend.rows[0]!.status, "paid");
  assert.equal(trend.rows[0]!.paid_at?.toISOString(), paid.rows[0]!.paid_at.toISOString());
});
