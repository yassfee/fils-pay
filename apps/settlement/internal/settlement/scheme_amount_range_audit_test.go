package settlement

import (
	"context"
	"testing"
	"time"
)

// GO-1 (F1, ADR-0001/0002): a scheme line is whole fils truncated to 10, and
// the API accepts any safe-integer amount, so the two-decimal copy must hold
// every int64 fils / 1000. A 100,000,000.000 BD capture overflowed
// NUMERIC(10,2) and failed the whole close (RunDailyBatch then stops for every
// merchant after this one).
func TestCloseBatch_SchemeAmountHoldsLargeLine(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	var platformBefore int64
	if err := pool.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&platformBefore); err != nil {
		t.Fatalf("read platform_stats: %v", err)
	}
	t.Cleanup(func() { // keep the FEES-1 volume tier where the other suites expect it
		_, _ = pool.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = $1 WHERE id = 1`, platformBefore)
	})
	merchantID := insertActiveMerchant(t, pool, 250)
	businessDate := time.Date(2026, 3, 26, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, 250, 100_000_000_005, start.Add(time.Hour))
	result, err := CloseBatch(ctx, pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	var amountFils int64
	var amount string
	if err := pool.QueryRow(ctx, `SELECT amount_fils, amount::text FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID).Scan(&amountFils, &amount); err != nil {
		t.Fatalf("read scheme line: %v", err)
	}
	if amountFils != 100_000_000_000 || amount != "100000000.00" {
		t.Errorf("scheme line = %d fils / %q, want 100000000000 / \"100000000.00\"", amountFils, amount)
	}
}
