-- CW-1 / INC-2026-08-21: one payout-rail disbursement record per paid settlement batch.
-- The api webhook dispatcher wrote one row per settlement.paid delivery (per endpoint, per replay, per racing pass).
-- Keep the earliest row per batch (finance should review the removed duplicates before this runs in production).
DELETE FROM settlement_payout_disbursements d
 USING settlement_payout_disbursements k
 WHERE d.settlement_batch_id = k.settlement_batch_id
   AND (d.created_at, d.id) > (k.created_at, k.id);

CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id);
