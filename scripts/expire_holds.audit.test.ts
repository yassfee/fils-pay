import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";
import { buildExpiredHoldsDelete } from "./expire_holds.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("expire_holds.audit.test.ts requires DATABASE_URL");

// HOLD-1: main() runs buildExpiredHoldsDelete(fetchExpiredHoldIds()). Holds are never deleted
// (HANDOVER, YA): expiry flips 'active' -> 'expired', and an empty night changes nothing.
// Runs inside a rolled-back transaction because the buggy statement is a bare DELETE FROM holds.
test("an empty night changes no rows, and expiry marks holds expired instead of deleting them", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const m = await client.query<{ id: string }>(
      `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`,
      [`Holds ${randomUUID()}`],
    );
    const merchantId = m.rows[0]!.id;
    const holds = await client.query<{ id: string }>(
      `INSERT INTO holds (merchant_id, amount_fils, status, expires_at) VALUES
         ($1, 1000, 'released', now() - interval '1 day'),
         ($1, 2000, 'active',   now() + interval '1 day'),
         ($1, 3000, 'active',   now() - interval '1 day')
       RETURNING id`,
      [merchantId],
    );
    const expiredId = holds.rows[2]!.id;

    const emptyNight = buildExpiredHoldsDelete([]);
    await client.query(emptyNight.text, emptyNight.values);
    const oneExpired = buildExpiredHoldsDelete([expiredId]);
    await client.query(oneExpired.text, oneExpired.values);

    const after = await client.query<{ amount_fils: string; status: string }>(
      `SELECT amount_fils, status FROM holds WHERE merchant_id = $1 ORDER BY amount_fils`,
      [merchantId],
    );
    assert.deepEqual(
      after.rows.map((r) => [Number(r.amount_fils), r.status]),
      [[1000, "released"], [2000, "active"], [3000, "expired"]],
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
