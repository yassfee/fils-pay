package settlement

import (
	"context"
	"testing"
	"time"
)

// NOTIFY-1 (INC-2026-08-21): two enqueuers (daemon + run-batch CLI) racing
// on the same paid batch must produce ONE settlement.paid event. The
// competing enqueuer is simulated as an uncommitted insert, which the
// NOT EXISTS check cannot see.
func TestEnqueuePayoutNotifications_ConcurrentEnqueueIsSingle(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	businessDate := time.Date(2026, 3, 27, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, 250, 10_000, start.Add(time.Hour))
	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}

	other, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := other.Exec(ctx, `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
		VALUES ('settlement.paid', 'settlement_batch', $1, '{}')`, closed.BatchID); err != nil {
		t.Fatalf("competing insert: %v", err)
	}
	done := make(chan error, 1)
	go func() { _, err := EnqueuePayoutNotifications(ctx, pool); done <- err }()
	time.Sleep(300 * time.Millisecond) // let the enqueuer pass its NOT EXISTS check
	if err := other.Commit(ctx); err != nil {
		t.Fatalf("commit competing insert: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("EnqueuePayoutNotifications: %v", err)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1`, closed.BatchID); n != 1 {
		t.Errorf("settlement.paid events for one batch = %d, want 1", n)
	}
}
