package settlement

import (
	"context"
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// EST-1 (G2): the lifetime payout figure is money, so it must be exact
// integer fils (case file: 1 BD = 1000 fils, integer fils). A float32/REAL
// accumulator drifts above 2^24 fils (16,777.216 BD).
func TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for _, net := range []money.Fils{22_219_551, 9_334_173} {
		if err := UpdateLifetimePayoutMonitoringEstimate(ctx, tx, merchantID, net); err != nil {
			t.Fatalf("UpdateLifetimePayoutMonitoringEstimate(%d): %v", net, err)
		}
	}
	var got string
	if err := tx.QueryRow(ctx, `SELECT lifetime_net_payout_monitoring_estimate::numeric::text FROM merchants WHERE id = $1`, merchantID).Scan(&got); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != "31553724" {
		t.Errorf("lifetime estimate = %s, want exactly 31553724 (22219551 + 9334173)", got)
	}
}
