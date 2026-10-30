package scheduler

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// K-1: one merchant whose payout fails (here a split parent whose child
// weights total 5000 bps, which PayoutSplitBatch refuses) must not stop the
// daemon closing and paying every merchant sorted after it, nor stop the
// settlement.paid notifications for batches that are already paid.
func TestRunIfDue_OneFailingMerchantDoesNotStopTheRest(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	insertMerchant := func(idPrefix string) (id uuid.UUID) {
		if err := pool.QueryRow(ctx, `INSERT INTO merchants (id, display_name, mdr_bps, status, test_mode)
			VALUES (COALESCE(NULLIF($1, '') || substr(md5(random()::text), 1, 12), gen_random_uuid()::text)::uuid, $2, 250, 'active', false) RETURNING id`,
			idPrefix, "k1-"+uuid.NewString()).Scan(&id); err != nil {
			t.Fatalf("insert merchant: %v", err)
		}
		return id
	}
	bad := insertMerchant("")
	defer pool.Exec(ctx, `UPDATE merchants SET status = 'closed' WHERE id = $1`, bad) //nolint:errcheck // keep later full-run tests in the shared DB unaffected
	if _, err := pool.Exec(ctx, `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, 5000)`,
		bad, insertMerchant("")); err != nil {
		t.Fatalf("insert split child: %v", err)
	}
	good := insertMerchant("ffffffff-ffff-4fff-bfff-") // sorts after every other merchant
	var paidBatch uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
		VALUES ($1, '2026-01-05', 'paid', 1025, 25, 1000, now(), now()) RETURNING id`, good).Scan(&paidBatch); err != nil {
		t.Fatalf("insert paid batch: %v", err)
	}

	runIfDue(ctx, pool, 0) // business date = yesterday (Asia/Bahrain)

	yesterday := time.Now().In(time.FixedZone("Asia/Bahrain", 3*60*60)).AddDate(0, 0, -1).Format("2006-01-02")
	var paid, notified int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2::date AND status = 'paid'`,
		good, yesterday).Scan(&paid); err != nil {
		t.Fatalf("count batches: %v", err)
	}
	if paid != 1 {
		t.Errorf("merchant sorted after the failing one: %d paid batch(es) for %s, want 1 (the daemon stopped at the failing merchant)", paid, yesterday)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1`, paidBatch).Scan(&notified); err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if notified != 1 {
		t.Errorf("already-paid batch: %d settlement.paid event(s), want 1 (one merchant's failure skipped every notification)", notified)
	}
}
