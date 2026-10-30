import type { Pool } from "pg";

/** Operational record of a payout-rail instruction for a settlement batch. */
export async function recordPayoutDisbursementEffect(
  pool: Pool,
  settlementBatchId: string,
  amountFils: number,
): Promise<void> {
  if (amountFils <= 0) {
    // Void batches (zero or negative net) carry no payout instruction.
    return;
  }

  await pool.query(
    `INSERT INTO settlement_payout_disbursements (settlement_batch_id, amount_fils, disbursement_reference)
     SELECT $1, $2, 'disb_' || gen_random_uuid()
      WHERE NOT EXISTS (SELECT 1 FROM settlement_payout_disbursements WHERE settlement_batch_id = $1) -- K-7: also rows before the 0087 cutoff
     ON CONFLICT (settlement_batch_id) WHERE created_at >= '2026-10-30 00:00:00+03' DO NOTHING`, // CW-1: once per batch (0087)
    [settlementBatchId, amountFils],
  );
}
