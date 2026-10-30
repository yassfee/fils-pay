package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/ledger"
)

// BAL-2 (F4): merchant_balances is maintained by close (+net) and payout (-net); a capture or refund the API has
// journaled but no batch has closed yet has not reached the cache. A rebuild must produce that same figure, so
// "CloseBatch then rebuild" leaves the cache unchanged instead of counting unbatched legs a second time at close.
func TestRebuild_CloseBatchThenRebuildLeavesCacheUnchanged(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertDiscountedMerchant(t, pool, 250, 1000) // fee 2.5%, 10% of it discounted
	day1 := time.Date(2026, 4, 7, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	start1, _ := BusinessDayWindow(day1)
	start2, _ := BusinessDayWindow(day2)

	txnA, _ := insertBookedCapture(t, pool, merchantID, 250, 1000, 10_000, start1.Add(time.Hour)) // fee 250-25, net 9,775
	closed1, err := CloseBatch(ctx, pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day 1: %v", err)
	}
	insertBookedCapture(t, pool, merchantID, 250, 1000, 20_000, start2.Add(time.Hour)) // unbatched, fee 500-50, net 19,550
	refundAt := start2.Add(2 * time.Hour)
	insertRefund(t, pool, merchantID, txnA, 1_000, 25, refundAt) // unbatched, net -975
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, $3, 'merchant_payable', 'debit', 1000, $4, 'refund: gross'), ($1, $2, $3, 'card_scheme_clearing', 'credit', 1000, $4, 'refund: gross'),
		       ($1, $2, $3, 'platform_fee_revenue', 'debit', 25, $4, 'refund: MDR fee reversal'), ($1, $2, $3, 'merchant_payable', 'credit', 25, $4, 'refund: MDR fee reversal')
	`, uuid.New(), merchantID, txnA, refundAt); err != nil {
		t.Fatalf("refund legs: %v", err)
	}

	assertCache(t, pool, merchantID, 9_775, "after close of day 1")
	if _, err := ledger.RebuildAllBalances(ctx, pool); err != nil {
		t.Fatalf("RebuildAllBalances: %v", err)
	}
	assertCache(t, pool, merchantID, 9_775, "rebuild right after close must not move the cache")
	if got, err := ledger.RebuildMerchantBalance(ctx, pool, merchantID); err != nil || got != 9_775 {
		t.Fatalf("RebuildMerchantBalance = %d (%v), want 9775", got, err)
	}

	if _, err := PayoutBatch(ctx, pool, closed1.BatchID); err != nil {
		t.Fatalf("PayoutBatch day 1: %v", err)
	}
	closed2, err := CloseBatch(ctx, pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day 2: %v", err)
	}
	assertCache(t, pool, merchantID, 18_575, "after close of day 2 (19,550 - 975)")
	if _, err := PayoutBatch(ctx, pool, closed2.BatchID); err != nil {
		t.Fatalf("PayoutBatch day 2: %v", err)
	}
	if _, err := ledger.RebuildAllBalances(ctx, pool); err != nil {
		t.Fatalf("RebuildAllBalances: %v", err)
	}
	assertCache(t, pool, merchantID, 0, "everything closed and paid")
}

func assertCache(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, want int64, when string) {
	t.Helper()
	var got int64
	if err := pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&got); err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if got != want {
		t.Fatalf("cached_payable_fils %s = %d, want %d", when, got, want)
	}
}
