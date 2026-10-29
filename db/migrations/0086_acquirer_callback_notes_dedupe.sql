-- CW-5 / FP-201: the acquirer redelivers a callback (same callbackId) up to 5 times.
-- Keep the earliest note per (transaction_id, callback_id), then make redeliveries a no-op.
DELETE FROM acquirer_callback_notes a
 USING acquirer_callback_notes b
 WHERE a.transaction_id = b.transaction_id
   AND a.callback_id = b.callback_id
   AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX uq_acquirer_callback_notes_txn_callback
    ON acquirer_callback_notes (transaction_id, callback_id);
