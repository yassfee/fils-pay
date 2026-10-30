/**
 * RPT-SCOPE-1: the report filter may name a split child only when the caller is that child's parent
 * (merchant_split_children.parent_merchant_id, migration 0045). Any other caller keeps its own scope.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("scope.audit.test.ts requires DATABASE_URL");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(() => pool.end());

async function merchant(label: string): Promise<string> {
  const r = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `RPT-SCOPE-1 ${label} ${randomUUID()}`,
  ]);
  return r.rows[0]!.id;
}

test("RPT-SCOPE-1: only the parent may scope a report to its split child", async () => {
  const [stranger, parent, child] = [await merchant("A"), await merchant("P"), await merchant("C")];
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 10000)`,
    [parent, child],
  );
  assert.equal(await resolveReportMerchantId(pool, stranger, child), stranger, "a non-parent read a split child's report");
  assert.equal(await resolveReportMerchantId(pool, parent, child), child, "the marketplace parent lost its child view");
});
