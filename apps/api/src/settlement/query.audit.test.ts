/**
 * SUM-1 (H6, FP-300 ☐5): the settlement summary must sum each capture's own delta
 * (transaction_events.amount_fils, as batch.go does), never the running
 * transactions.captured_fils once per capture event.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getSettlementSummary } from "./query.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
test.after(async () => {
  await pool.end();
});

test("summary counts each capture delta once for a multi-capture transaction", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`SUM-1 merchant ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
     VALUES ($1, 'captured', 30000, 30000, $2, '2026-01-05T08:00:00Z') RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );
  // 30.000 BD captured as 12.000 + 10.000 + 8.000 BD inside Bahrain day 2026-01-05.
  for (const [type, fils, at] of [
    ["partially_captured", 12_000, "2026-01-05T09:00:00Z"],
    ["partially_captured", 10_000, "2026-01-05T10:00:00Z"],
    ["captured", 8_000, "2026-01-05T11:00:00Z"],
  ] as const) {
    await pool.query(
      `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
       VALUES ($1, $2, $3, 'system', $4)`,
      [txn.rows[0]!.id, type, fils, at],
    );
  }
  const summary = await getSettlementSummary(pool, { merchantId, from: "2026-01-05", to: "2026-01-06" });
  assert.equal(summary.transactionCount, 1);
  assert.equal(summary.totalCapturedFils, 30_000);
});

// SUM-2 (H6): the summary's window must be served by an index on batched capture events by time
// (the only occurred_at index, idx_transaction_events_unbatched, is partial on settlement_batch_id IS NULL).
test("summary SQL can use idx_transaction_events_captures_by_time for the occurred_at window", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    await client.query("SET LOCAL enable_nestloop = off"); // plan as for a large merchant (hash join, H6)
    let plan = "";
    const explainPool = {
      query: async (sql: string, params: unknown[]) => {
        const r = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
        plan = JSON.stringify(r.rows[0]);
        return { rows: [] };
      },
    };
    await getSettlementSummary(explainPool as unknown as Pool, { merchantId: randomUUID(), from: "2026-01-01", to: "2026-02-01" });
    assert.match(plan, /idx_transaction_events_captures_by_time/);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
