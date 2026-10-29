package settlement

import (
	"context"
	"testing"
	"time"
)

// CLOSE-1 (H5): a business day's batch must not close before its
// Asia/Bahrain window has ended, or captures later that day are stranded
// (the batch is already closed/paid and never picks them up).
func TestRunDailyBatch_RefusesUnfinishedBusinessDay(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	today := time.Now().In(businessDayLocation)
	insertCaptureEvent(t, pool, merchantID, 250, 10_000, time.Now().Add(-time.Second))

	if _, err := RunDailyBatch(ctx, pool, today, &merchantID); err == nil {
		t.Error("RunDailyBatch for today's (unfinished) Bahrain business day succeeded, want an error")
	}
	if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1 AND status <> 'open'`, merchantID); n != 0 {
		t.Errorf("%d batch(es) closed/paid for an unfinished business day, want 0", n)
	}
}
