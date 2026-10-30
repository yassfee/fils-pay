/**
 * ADMIN-KYC-1: bulk approve moves only merchants that are under_review (bulkKyc.ts docstring,
 * ADMIN.md) and writes one merchant_kyc_reviews row per approval, the table migration 0016 names
 * "the single source of truth for KYC approval".
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { bulkApproveMerchantsKyc } from "./bulkKyc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("bulkKyc.audit.test.ts requires DATABASE_URL");
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(() => pool.end());

async function merchant(status: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ($1, 250, $2) RETURNING id`,
    [`ADMIN-KYC-1 ${status} ${randomUUID()}`, status],
  );
  return r.rows[0]!.id;
}

test("ADMIN-KYC-1: bulk approve skips non-under_review merchants and writes a review row per approval", async () => {
  const admin = await pool.query<{ id: string; email: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'unused', 'KYC', 'finance') RETURNING id, email`,
    [`kyc-${randomUUID()}@admin.test`],
  );
  const [pending, rejected, submitted] = [await merchant("under_review"), await merchant("rejected"), await merchant("submitted")];

  const res = await bulkApproveMerchantsKyc(pool, { merchantIds: [pending, rejected, submitted], adminUserId: admin.rows[0]!.id, notes: "t" });
  assert.deepEqual(res.approvedMerchantIds, [pending]);

  const st = await pool.query<{ id: string; onboarding_status: string; kyc_passed: boolean }>(
    `SELECT id, onboarding_status, kyc_passed FROM merchants WHERE id = ANY($1)`,
    [[rejected, submitted]],
  );
  for (const row of st.rows) assert.equal(row.kyc_passed, false, `${row.onboarding_status} merchant was approved`);

  const reviews = await pool.query<{ merchant_id: string; outcome: string; reviewer_identifier: string; reviewer_admin_user_id: string }>(
    `SELECT merchant_id, outcome, reviewer_identifier, reviewer_admin_user_id FROM merchant_kyc_reviews WHERE merchant_id = ANY($1)`,
    [[pending, rejected, submitted]],
  );
  assert.deepEqual(reviews.rows, [
    { merchant_id: pending, outcome: "approved", reviewer_identifier: admin.rows[0]!.email, reviewer_admin_user_id: admin.rows[0]!.id },
  ]);
});
