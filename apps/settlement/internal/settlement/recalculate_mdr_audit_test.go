package settlement

import (
	"context"
	"testing"
	"time"
)

// MDR-1 (F5): RecalculateMDR must never re-price a PAID batch. Its fee and
// net have gone to the bank, the webhook and the statement.
func TestRecalculateMDR_PaidBatchUntouched(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	businessDate := time.Date(2026, 3, 26, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, 250, 10_000, start.Add(time.Hour))
	closed, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("raise mdr: %v", err)
	}
	result, err := RecalculateMDR(ctx, pool, merchantID, businessDate, businessDate.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(result.Adjusted) != 0 {
		t.Errorf("adjusted %d paid batch(es), want 0", len(result.Adjusted))
	}
	fee := countRows(t, pool, `SELECT fee_fils FROM settlement_batches WHERE id = $1`, closed.BatchID)
	if fee != int(closed.FeeFils) {
		t.Errorf("paid batch fee_fils = %d, want unchanged %d", fee, closed.FeeFils)
	}
}
