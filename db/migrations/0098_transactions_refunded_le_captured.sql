-- FP-300 (design §4.4): the database itself refuses a refund total above the
-- captured amount, behind processRefund's row lock and validation (REF-1, REF-3).
ALTER TABLE transactions
    ADD CONSTRAINT transactions_refunded_le_captured CHECK (refunded_fils <= captured_fils);
