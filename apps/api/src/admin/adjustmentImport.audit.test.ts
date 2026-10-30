/**
 * IMP-2 audit (F7): the same CSV applied twice (the 2026-09-04 double-click,
 * aug-adjustments-v3-FINAL.csv posted at 11:18:40 and 11:19:02) must post once.
 * The second identical upload is refused with 409 duplicate_import.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { applyAdjustmentImport } from "./adjustmentImport.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
after(async () => {
  await pool.end();
});

async function insertId(sql: string): Promise<string> {
  return (await pool.query<{ id: string }>(sql, [randomUUID()])).rows[0]!.id;
}

test("IMP-2: an identical CSV re-upload (sequential and concurrent) posts only once", async () => {
  const adminUserId = await insertId(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1 || '@admin.test', 'x', 'IMP-2', 'finance') RETURNING id`,
  );
  const merchantId = await insertId(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode) VALUES ($1, 250, 'active', false) RETURNING id`,
  );
  const input = { adminUserId, originalFilename: "pasted.csv", rows: [{ merchantId, amount: "4.75", reason: "fix" }] };

  const results = await Promise.allSettled([applyAdjustmentImport(pool, input), applyAdjustmentImport(pool, input)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "exactly one concurrent upload applies");
  await assert.rejects(applyAdjustmentImport(pool, input), (e: { code?: string }) => e.code === "duplicate_import");

  const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM adjustment_import_rows WHERE merchant_id = $1`, [merchantId]);
  assert.equal(rows.rows[0].n, 1, "4.750 BD must be posted once, not 9.500 BD");
  const bal = await pool.query(`SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, [merchantId]);
  assert.equal(Number(bal.rows[0].cached_payable_fils), 4750);
});
