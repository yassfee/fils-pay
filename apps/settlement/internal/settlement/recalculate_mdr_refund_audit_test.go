package settlement

import (
	"context"
	"testing"
	"time"
)

// RecalculateMDR re-prices a closed batch; it must keep the refund netting
// (net moves by the fee difference only, never back to gross − fee).
func TestRecalculateMDR_KeepsRefundNetting(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 275)
	day := time.Date(2026, 5, 9, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	txnID, _ := insertCaptureEvent(t, pool, merchantID, 275, 10_000, start.Add(time.Hour))
	insertRefund(t, pool, merchantID, txnID, 3_333, 92, start.Add(2*time.Hour))
	res, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, merchantID); err != nil {
		t.Fatalf("raise mdr: %v", err)
	}
	if _, err := RecalculateMDR(ctx, pool, merchantID, day, day.AddDate(0, 0, 1)); err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	var net int64
	if err := pool.QueryRow(ctx, `SELECT net_payout_fils FROM settlement_batches WHERE id = $1`, res.BatchID).Scan(&net); err != nil {
		t.Fatalf("read net: %v", err)
	}
	if want := int64((10_000 - 300) - (3_333 - 92)); net != want { // 6,459
		t.Errorf("net after re-price = %d, want %d", net, want)
	}
}
