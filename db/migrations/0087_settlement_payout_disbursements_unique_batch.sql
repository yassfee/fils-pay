-- CW-1 / INC-2026-08-21: one payout-rail disbursement record per paid settlement batch.
-- The api webhook dispatcher wrote one row per settlement.paid delivery (per endpoint, per replay, per racing pass).
-- Financial records are never deleted: rows written before this fix keep their duplicates for finance to
-- review (query in docs/audit/findings/CW-1.md); the index holds every new row to one per batch.
CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id)
    WHERE created_at >= '2026-10-30 00:00:00+03';
