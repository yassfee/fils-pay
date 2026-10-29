-- SUM-2 / H6: the settlement summary (apps/api/src/settlement/query.ts) and the reporting parity check
-- (apps/reporting/src/consumer/applyEvent.ts) filter capture events by an occurred_at window, but the only
-- occurred_at index (0023 idx_transaction_events_unbatched) is partial on settlement_batch_id IS NULL, so once
-- CloseBatch claims an event nothing serves the window and large merchants seq-scan transaction_events.
CREATE INDEX idx_transaction_events_captures_by_time
    ON transaction_events (occurred_at) INCLUDE (transaction_id, amount_fils)
 WHERE event_type IN ('captured', 'partially_captured');
