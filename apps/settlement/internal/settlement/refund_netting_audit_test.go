package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// FP-300 §8: a succeeded refund (amount r, fee reversed f) is netted into
// the merchant's next payout: net = Σ(gross − fee) − Σ(r − f), integer fils.
func insertRefund(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, r, f int64, occurredAt time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status, acquirer_reference, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', $5, 'merchant_session', $6, $7) RETURNING id
	`, txnID, merchantID, r, f, "rf-"+uuid.New().String(), uuid.New(), occurredAt).Scan(&id); err != nil {
		t.Fatalf("insertRefund: %v", err)
	}
	return id
}

func refundBatchID(t *testing.T, pool *pgxpool.Pool, refundID uuid.UUID) *uuid.UUID {
	t.Helper()
	var id *uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, refundID).Scan(&id); err != nil {
		t.Fatalf("read refund batch: %v", err)
	}
	return id
}

func batchRefundTotals(t *testing.T, pool *pgxpool.Pool, batchID uuid.UUID) (gross, fee int64) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `SELECT refund_gross_fils, refund_fee_reversed_fils FROM settlement_batches WHERE id = $1`, batchID).Scan(&gross, &fee); err != nil {
		t.Fatalf("read batch refund totals: %v", err)
	}
	return gross, fee
}

// (a) captures 10,000 (fee 275) and one refund 3,333 (fee reversed 92):
// net = (10,000 − 275) − (3,333 − 92) = 6,484 exactly; the refund is stamped.
func TestCloseBatch_NetsRefundIntoPayout(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 275)
	day := time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	txnID, _ := insertCaptureEvent(t, pool, merchantID, 275, 10_000, start.Add(time.Hour))
	refundID := insertRefund(t, pool, merchantID, txnID, 3_333, 92, start.Add(2*time.Hour))

	res, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if res.GrossFils != 10_000 || res.FeeFils != 275 || res.NetPayoutFils != 6_484 {
		t.Errorf("gross/fee/net = %d/%d/%d, want 10000/275/6484", res.GrossFils, res.FeeFils, res.NetPayoutFils)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != res.BatchID {
		t.Errorf("refund settlement_batch_id = %v, want %s", got, res.BatchID)
	}
	if g, f := batchRefundTotals(t, pool, res.BatchID); g != 3_333 || f != 92 {
		t.Errorf("batch refund totals = %d/%d, want 3333/92", g, f)
	}
	var stored int64
	if err := pool.QueryRow(ctx, `SELECT net_payout_fils FROM settlement_batches WHERE id = $1`, res.BatchID).Scan(&stored); err != nil || stored != 6_484 {
		t.Errorf("stored net_payout_fils = %d (err %v), want 6484", stored, err)
	}
	pay, err := PayoutBatch(ctx, pool, res.BatchID)
	if err != nil || pay.NetPayoutFils != 6_484 {
		t.Fatalf("PayoutBatch = %+v, %v; want net 6484", pay, err)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND account_id = 'platform_cash' AND amount_fils = 6484`, res.BatchID); n != 1 {
		t.Errorf("platform_cash payout legs of 6484 = %d, want 1", n)
	}
}

// (b) a refund larger than the day's net is not claimed (net stays ≥ 0)
// and rolls into the next day's batch; (c) a re-close never claims twice.
func TestCloseBatch_RefundLargerThanNetRollsForward(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 275)
	day1 := time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)
	day2 := day1.AddDate(0, 0, 1)
	s1, _ := BusinessDayWindow(day1)
	s2, _ := BusinessDayWindow(day2)
	txnID, _ := insertCaptureEvent(t, pool, merchantID, 275, 1_000, s1.Add(time.Hour))   // day-1 net 1,000 − 28 = 972
	refundID := insertRefund(t, pool, merchantID, txnID, 2_000, 55, s1.Add(2*time.Hour)) // r − f = 1,945 > 972
	insertCaptureEvent(t, pool, merchantID, 275, 10_000, s2.Add(time.Hour))              // day-2 net 9,725

	r1, err := CloseBatch(ctx, pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day1: %v", err)
	}
	if r1.NetPayoutFils != 972 || refundBatchID(t, pool, refundID) != nil {
		t.Errorf("day1 net = %d, refund batch = %v; want 972 and unclaimed", r1.NetPayoutFils, refundBatchID(t, pool, refundID))
	}
	r2, err := CloseBatch(ctx, pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day2: %v", err)
	}
	if want := money.Fils(9_725 - 1_945); r2.NetPayoutFils != want {
		t.Errorf("day2 net = %d, want %d", r2.NetPayoutFils, want)
	}
	if got := refundBatchID(t, pool, refundID); got == nil || *got != r2.BatchID {
		t.Errorf("refund claimed by %v, want day-2 batch %s", got, r2.BatchID)
	}
	again, err := CloseBatch(ctx, pool, merchantID, day2)
	if err != nil || !again.AlreadyClosed || again.NetPayoutFils != r2.NetPayoutFils {
		t.Errorf("re-close = %+v, %v; want AlreadyClosed with net %d", again, err, r2.NetPayoutFils)
	}
	if n := countRows(t, pool, `SELECT count(*) FROM refunds WHERE merchant_id = $1 AND settlement_batch_id IS NOT NULL`, merchantID); n != 1 {
		t.Errorf("claimed refunds = %d, want 1", n)
	}
}

// (d) a split parent's refund-reduced net is split exactly (SPLIT-1).
func TestCloseBatch_SplitParentChildrenSumToNettedNet(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	parent := insertActiveMerchant(t, pool, 275)
	for _, w := range []int64{3333, 3333, 3334} {
		if _, err := pool.Exec(ctx, `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, $3)`, parent, insertActiveMerchant(t, pool, 275), w); err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}
	day := time.Date(2026, 5, 7, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	txnID, _ := insertCaptureEvent(t, pool, parent, 275, 10_000, start.Add(time.Hour))
	insertRefund(t, pool, parent, txnID, 3_333, 92, start.Add(2*time.Hour))

	report, err := RunDailyBatch(ctx, pool, day, &parent)
	if err != nil || len(report.MerchantResults) != 1 || report.MerchantResults[0].NetPayoutFils != 6_484 {
		t.Fatalf("RunDailyBatch = %+v, %v; want parent net 6484", report, err)
	}
	var total int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(sum(allocated_fils), 0) FROM settlement_batch_splits WHERE settlement_batch_id = $1`, report.MerchantResults[0].BatchID).Scan(&total); err != nil || total != 6_484 {
		t.Errorf("children got %d fils (err %v), want exactly 6484", total, err)
	}
}
