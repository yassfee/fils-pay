package splits

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SPLIT-1 (F3, H2): split children must receive exactly the batch's net
// payout (largest remainder, as packages/money allocateRemainder), never
// lose or invent the rounding remainder. 100 fils at 3333/3333/3334 bps
// must split 33/33/34 (rounding each child separately gives 33/33/33).
func TestPayoutSplitBatch_SharesSumToNet(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	newMerchant := func() (id uuid.UUID) {
		if err := pool.QueryRow(ctx, `INSERT INTO merchants (display_name, mdr_bps, status, test_mode) VALUES ($1, 250, 'active', false) RETURNING id`,
			"split-audit-"+uuid.New().String()).Scan(&id); err != nil {
			t.Fatalf("insert merchant: %v", err)
		}
		return id
	}
	parent := newMerchant()
	for _, w := range []int64{3333, 3333, 3334} {
		if _, err := pool.Exec(ctx, `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, $3)`, parent, newMerchant(), w); err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}
	var batchID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, '2026-04-20', 'closed', 103, 3, 100, now()) RETURNING id`, parent).Scan(&batchID); err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	if _, err := PayoutSplitBatch(ctx, pool, batchID); err != nil {
		t.Fatalf("PayoutSplitBatch: %v", err)
	}
	rows, err := pool.Query(ctx, `SELECT split_weight_bps, allocated_fils FROM settlement_batch_splits WHERE settlement_batch_id = $1`, batchID)
	if err != nil {
		t.Fatalf("query splits: %v", err)
	}
	defer rows.Close()
	var total int64
	for rows.Next() {
		var w, got int64
		if err := rows.Scan(&w, &got); err != nil {
			t.Fatalf("scan: %v", err)
		}
		total += got
		if want := map[int64]int64{3333: 33, 3334: 34}[w]; got != want {
			t.Errorf("child at %d bps got %d fils, want %d", w, got, want)
		}
	}
	if total != 100 {
		t.Errorf("children got %d fils in total, want the full net payout 100", total)
	}
}
