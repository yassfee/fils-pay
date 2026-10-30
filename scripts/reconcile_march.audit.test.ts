import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { fetchResidueRows, postResidueCorrection } from "./reconcile_march.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("reconcile_march.audit.test.ts requires DATABASE_URL");

// Case file F2: "someone ran it twice on staging and the gap doubled ... Is it safe to run again?"
test("re-running the March residue sweep posts nothing the second time", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`,
      [`Sweep ${randomUUID()}`],
    );
    const merchant = { merchantId: m.rows[0]!.id, lineCount: 3, residueFils: 17 };
    await postResidueCorrection(client, merchant, new Date());
    await postResidueCorrection(client, merchant, new Date());
    const legs = await client.query<{ n: string; total: string }>(
      `SELECT count(*) AS n, COALESCE(SUM(amount_fils), 0) AS total
         FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'`,
      [merchant.merchantId],
    );
    assert.equal(Number(legs.rows[0]!.n), 1, "one correction group per merchant, however many runs");
    assert.equal(Number(legs.rows[0]!.total), 17);
  } finally {
    await client.end();
  }
});

// Lead S6: a test-mode merchant never settles (batch.go:121 `test_mode = false`), so its sandbox
// captures never reach the scheme file and leave no residue; the sweep must not write one off.
test("the March residue sweep skips test-mode merchants", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, test_mode) VALUES ($1, true) RETURNING id`,
      [`Sandbox ${randomUUID()}`],
    );
    const sandboxId = m.rows[0]!.id;
    await client.query(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'captured', 1005, 1005, $2, '2026-03-15T09:00:00Z')`,
      [sandboxId, `acq-${randomUUID()}`],
    );
    const rows = await fetchResidueRows(client, 2026, 3);
    assert.deepEqual(rows.filter((r) => r.merchantId === sandboxId), [], "a sandbox capture has no scheme residue to sweep");
  } finally {
    await client.end();
  }
});
