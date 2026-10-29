-- FP-300 box 5 (reports): the reporting consumer rolls refund.succeeded events
-- into the merchant's Asia/Bahrain business day (applyDailySummaryRollup).
ALTER TABLE merchant_daily_volume
    ADD COLUMN refund_count      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN refund_gross_fils BIGINT  NOT NULL DEFAULT 0;
