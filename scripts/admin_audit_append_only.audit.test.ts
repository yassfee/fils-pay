import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("admin_audit_append_only.audit.test.ts requires DATABASE_URL");

// C5: an admin (or a SQL injection, or a buggy job) could rewrite or delete the record of what an admin did.
// The one legitimate UPDATE is markAdminAuditOutcome (adminAudit/log.ts:112): outcome + metadata merge.
// Each statement runs in its own rolled-back savepoint so nothing persists.
test("C5: admin_audit_log rows cannot be rewritten or deleted, only given an outcome", async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'x', 'C5', 'super_admin') RETURNING id`,
      [`c5-${randomUUID()}@example.test`],
    );
    const row = await client.query<{ id: string }>(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, metadata) VALUES ($1, 'balance_rebuild', 'platform', NULL, '{"date":"2026-10-30"}') RETURNING id`,
      [admin.rows[0]!.id],
    );
    const id = row.rows[0]!.id;
    const outcomes: string[] = [];
    for (const sql of [
      `UPDATE admin_audit_log SET outcome = 'failed', metadata = metadata || '{"error":"x"}'::jsonb WHERE id = $1`,
      `UPDATE admin_audit_log SET action = 'kyc_review' WHERE id = $1`,
      `UPDATE admin_audit_log SET created_at = created_at - interval '1 day' WHERE id = $1`,
      `UPDATE admin_audit_log SET metadata = '{"date":"2026-01-01"}' WHERE id = $1`,
      `DELETE FROM admin_audit_log WHERE id = $1`,
    ]) {
      await client.query("SAVEPOINT s");
      try {
        await client.query(sql, [id]);
        outcomes.push("allowed");
      } catch (err) {
        outcomes.push(/append-only/.test((err as Error).message) ? "rejected" : (err as Error).message);
      }
      await client.query("ROLLBACK TO SAVEPOINT s");
    }
    assert.deepEqual(outcomes, ["allowed", "rejected", "rejected", "rejected", "rejected"]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
