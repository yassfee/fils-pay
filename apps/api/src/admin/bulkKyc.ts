import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";

export interface BulkApproveMerchantsKycInput {
  merchantIds: string[];
  adminUserId: string;
  notes?: string;
}

/**
 * @property approvedMerchantIds Only merchants that moved from under_review to approved.
 * Already-approved or rejected ids are skipped and not listed.
 */
export interface BulkApproveMerchantsKycResult {
  approvedCount: number;
  approvedMerchantIds: string[];
}

/** Approves the given merchants and audits it. */
export async function bulkApproveMerchantsKyc(
  pool: Pool,
  input: BulkApproveMerchantsKycInput,
): Promise<BulkApproveMerchantsKycResult> {
  return withTransaction(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE merchants
          SET onboarding_status = 'approved', kyc_passed = true
        WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'
      RETURNING id`,
      [input.merchantIds],
    );
    const approvedMerchantIds = result.rows.map((row) => row.id);
    // ADMIN-KYC-1: the per-merchant review trail (0016: the single source of truth for KYC approval)
    await client.query(
      `INSERT INTO merchant_kyc_reviews (merchant_id, outcome, reviewer_identifier, reviewer_admin_user_id, notes)
       SELECT m, 'approved', a.email, a.id, $3 FROM unnest($1::uuid[]) AS m, admin_users a WHERE a.id = $2`,
      [approvedMerchantIds, input.adminUserId, input.notes ?? null],
    );

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "kyc_bulk_approve",
      targetType: "platform",
      targetId: null,
      metadata: {
        requestedMerchantIds: input.merchantIds,
        approvedMerchantIds,
        notes: input.notes ?? null,
      },
    });

    return { approvedCount: approvedMerchantIds.length, approvedMerchantIds };
  });
}
