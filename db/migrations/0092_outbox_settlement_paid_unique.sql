-- NOTIFY-1 (INC-2026-08-21): at most one settlement.paid event per batch.
-- EnqueuePayoutNotifications checks NOT EXISTS then inserts; two enqueuers
-- (daemon + run-batch CLI) both passed the check and inserted twice.
-- Existing duplicates are kept for audit (no delete) but relabelled and
-- marked processed so they are never dispatched again; the earliest
-- event per batch stays as the settlement.paid event.
UPDATE outbox_events oe
   SET event_type = 'settlement.paid.duplicate', processed_at = COALESCE(processed_at, now())
 WHERE event_type = 'settlement.paid'
   AND id > (SELECT min(id) FROM outbox_events o2
              WHERE o2.event_type = 'settlement.paid' AND o2.aggregate_id = oe.aggregate_id);

CREATE UNIQUE INDEX outbox_events_settlement_paid_once
    ON outbox_events (aggregate_id)
    WHERE event_type = 'settlement.paid';
