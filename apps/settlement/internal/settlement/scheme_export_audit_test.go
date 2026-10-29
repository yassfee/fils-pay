package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// SCHEME-1 (F1, ADR-0002): the scheme amount must be the truncated
// amount_fils/1000, never the untruncated gross rounded half-up by
// NUMERIC(10,2). 4747 -> 4.74 (not 4.75), 1005 -> 1.00 (not 1.01).
func TestSchemeExportAmountIsTruncatedFils(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	for i, amount := range []money.Fils{4747, 1005, 4740, 12344} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}
	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	rows, err := pool.Query(context.Background(),
		`SELECT amount_fils, amount::text FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	var total money.Fils
	for rows.Next() {
		var fils int64
		var amount string
		if err := rows.Scan(&fils, &amount); err != nil {
			t.Fatalf("scan: %v", err)
		}
		total += money.Fils(fils)
		if want := formatFilsAsTwoDecimalString(money.Fils(fils)); amount != want {
			t.Errorf("amount = %q for amount_fils %d, want %q", amount, fils, want)
		}
	}
	if total != 22_820 {
		t.Errorf("sum(amount_fils) = %d, want 22820", total)
	}
}
