/**
 * Case-file acceptance scenario for F2 (handoff case file, page 3): the March sweep script,
 * run twice the way main() runs it (fetch March 2026 residue rows, post one correction per
 * merchant, one transaction per run). Scoped to this test's own merchant; fixed timestamps.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { fetchResidueRows, postResidueCorrection } from "./reconcile_march.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("caseFile.acceptance.test.ts requires DATABASE_URL (a migrated Postgres)");

test("F2: running the March sweep script twice doubled the gap, now a second run posts nothing and the sweep takes exactly the March residue", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps, test_mode) VALUES ($1, 250, false) RETURNING id`,
      [`Case File f2 ${randomUUID()}`],
    );
    const merchantId = m.rows[0]!.id;
    // March 2026 in Bahrain: 00:30 on 1 March and 23:30 on 31 March are in; 00:30 on 1 April is out.
    const captures: Array<[number, string]> = [
      [4_755, "2026-02-28T21:30:00Z"], // 1 Mar 00:30 Bahrain: residue 5
      [1_003, "2026-03-15T09:00:00Z"], // residue 3
      [2_000, "2026-03-20T09:00:00Z"], // residue 0
      [9_999, "2026-03-31T20:30:00Z"], // 31 Mar 23:30 Bahrain: residue 9
      [7_777, "2026-03-31T21:30:00Z"], // 1 Apr 00:30 Bahrain: not March
    ];
    for (const [fils, at] of captures) {
      await client.query(
        `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
         VALUES ($1, 'captured', $2, $2, $3, $4)`,
        [merchantId, fils, `acqref_${randomUUID()}`, at],
      );
    }

    const runSweep = async () => {
      const rows = (await fetchResidueRows(client, 2026, 3)).filter((r) => r.merchantId === merchantId);
      const residueFils = rows.reduce((sum, r) => sum + (r.capturedFils % 10), 0);
      await client.query("BEGIN");
      await postResidueCorrection(client, { merchantId, lineCount: rows.length, residueFils }, new Date("2026-04-02T06:00:00Z"));
      await client.query("COMMIT");
    };
    await runSweep();
    await runSweep(); // "someone ran it twice"

    const swept = await client.query<{ account_id: string; direction: string; n: string; total: string }>(
      `SELECT account_id, direction, count(*)::text AS n, SUM(amount_fils)::text AS total
         FROM ledger_entries WHERE merchant_id = $1 GROUP BY account_id, direction ORDER BY account_id`,
      [merchantId],
    );
    assert.deepEqual(
      swept.rows.map((r) => [r.account_id, r.direction, Number(r.n), Number(r.total)]),
      [
        ["merchant_payable", "debit", 1, 17],
        ["scheme_rounding_residue", "credit", 1, 17],
      ],
      "one correction of 5 + 3 + 9 = 17 fils, not 34",
    );
  } finally {
    await client.end();
  }
});
