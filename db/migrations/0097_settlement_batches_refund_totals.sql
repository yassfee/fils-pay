-- FP-300 §8: refunds are netted into the merchant's next payout at batch close.
-- net_payout_fils = (gross_fils - fee_fils) - (refund_gross_fils - refund_fee_reversed_fils), integer fils.
ALTER TABLE settlement_batches
    ADD COLUMN refund_gross_fils        BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN refund_fee_reversed_fils BIGINT NOT NULL DEFAULT 0;
