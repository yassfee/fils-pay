import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("ledger_append_only.audit.test.ts requires DATABASE_URL");

// LED-1 / F2: 0007's balance trigger only rejects an UNBALANCED change, so scaling a whole group
// (both legs x10) or deleting it stayed balanced and committed: the F2 sweep doubling went unseen.
// Each statement runs in its own rolled-back savepoint so nothing persists.
test("ledger entries are append-only: balanced edits and deletes are rejected", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`Ledger ${randomUUID()}`]);
    const group = randomUUID();
    await client.query(
      `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES ($1, $2, 'merchant_payable', 'credit', 1000, now(), 'audit'), ($1, $2, 'card_scheme_clearing', 'debit', 1000, now(), 'audit')`,
      [group, m.rows[0]!.id],
    );
    for (const sql of [
      `UPDATE ledger_entries SET amount_fils = amount_fils * 10 WHERE entry_group_id = $1`,
      `DELETE FROM ledger_entries WHERE entry_group_id = $1`,
    ]) {
      await client.query("SAVEPOINT s");
      await assert.rejects(
        (async () => {
          await client.query(sql, [group]);
          await client.query("SET CONSTRAINTS ALL IMMEDIATE"); // run 0007's deferred balance check now
        })(),
        /append-only/,
        sql,
      );
      await client.query("ROLLBACK TO SAVEPOINT s");
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
