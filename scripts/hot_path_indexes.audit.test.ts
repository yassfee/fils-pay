/**
 * CAP-4: every capture inserts 4 ledger rows, and the deferred balance trigger (0007) re-sums each row's
 * entry_group_id at COMMIT. Capture also releases the hold by transaction_id. With no index on either column,
 * each checkout scans the whole ledger_entries table (4 times) and the whole holds table. That cost grows
 * with every payment ever taken. Under seq scans disabled, the plan must use an index.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("hot_path_indexes.audit.test.ts requires DATABASE_URL");

test("CAP-4: the balance trigger's and the hold release's lookups use an index, not a full table scan", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL enable_seqscan = off");
    const id = "00000000-0000-0000-0000-000000000000";
    for (const sql of [
      `SELECT sum(amount_fils) FROM ledger_entries WHERE entry_group_id = '${id}'`, // check_ledger_group_balance()
      `UPDATE holds SET status = 'released' WHERE transaction_id = '${id}' AND status = 'active'`, // capture.ts
    ]) {
      const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
      const plan = JSON.stringify(rows[0]["QUERY PLAN"]);
      assert.doesNotMatch(plan, /Seq Scan/, `${sql} scans the whole table: ${plan}`);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
