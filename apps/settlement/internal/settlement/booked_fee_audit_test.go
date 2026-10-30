package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// FEES-5 (option A, user decision 2026-10-30): CloseBatch charges the fee capture BOOKED in
// the ledger for each capture event, never a second Go-side price. Before the fix CloseBatch
// re-priced each event amount-first (discounted_fee.go), 1 fil off the ledger per discounted
// event, and PayoutBatch stranded the difference in merchant_payable.

func insertDiscountedMerchant(t *testing.T, pool *pgxpool.Pool, mdrBps, discountBps int64) uuid.UUID {
	t.Helper()
	id := insertActiveMerchant(t, pool, mdrBps)
	if _, err := pool.Exec(context.Background(), `UPDATE merchants SET negotiated_discount_bps = $2 WHERE id = $1`, id, discountBps); err != nil {
		t.Fatalf("set negotiated_discount_bps: %v", err)
	}
	return id
}

// insertBookedCapture writes what apps/api capture.ts writes after FEES-3, in one DB
// transaction (so every row shares now()): the capture event, then one entry group with the
// gross legs, the MDR fee legs, and the negotiated-discount legs (fee-first, CHANGELOG 1.3.1).
func insertBookedCapture(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, mdrBps, discountBps int64, amountFils money.Fils, occurredAt time.Time) (uuid.UUID, money.Fils) {
	t.Helper()
	ctx := context.Background()
	fee := money.ApplyRateFils(amountFils, mdrBps)
	discount := money.ApplyRateFils(fee, discountBps)
	var txnID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
		VALUES ($1, 'captured', $2, $2, $3, $4) RETURNING id
	`, merchantID, int64(amountFils), "acq-ref-"+uuid.New().String(), occurredAt).Scan(&txnID); err != nil {
		t.Fatalf("insertBookedCapture: transaction: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, metadata, occurred_at)
		VALUES ($1, 'captured', $2, 'system', jsonb_build_object('feeFils', $3::bigint), $4)
	`, txnID, int64(amountFils), int64(fee-discount), occurredAt); err != nil {
		t.Fatalf("insertBookedCapture: event: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, $7, 'capture: gross'),
		       ($1, $2, $3, 'merchant_payable',     'credit', $4, $7, 'capture: gross'),
		       ($1, $2, $3, 'merchant_payable',     'debit',  $5, $7, 'capture: MDR fee'),
		       ($1, $2, $3, 'platform_fee_revenue', 'credit', $5, $7, 'capture: MDR fee'),
		       ($1, $2, $3, 'platform_fee_revenue', 'debit',  $6, $7, 'capture: negotiated discount adjustment'),
		       ($1, $2, $3, 'merchant_payable',     'credit', $6, $7, 'capture: negotiated discount adjustment')
	`, uuid.New(), merchantID, txnID, int64(amountFils), int64(fee), int64(discount), occurredAt); err != nil {
		t.Fatalf("insertBookedCapture: ledger: %v", err)
	}
	return txnID, fee - discount
}

func ledgerNet(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, account string) int64 {
	t.Helper()
	var net int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::bigint
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = $2
	`, merchantID, account).Scan(&net); err != nil {
		t.Fatalf("ledgerNet(%s): %v", account, err)
	}
	return net
}

func TestCloseBatch_ChargesTheBookedDiscountedFee(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	cases := []struct {
		name                string
		mdrBps, discountBps int64
		amount, wantFee     money.Fils
		day                 time.Time
	}{
		// ledger: 602 x 275 bps = 16.555 -> 17, 12.5% of 17 = 2.125 -> 2, fee 15 (Go amount-first: 14)
		{"602 fils at 275 bps, 1250 bps discount", 275, 1250, 602, 15, time.Date(2026, 6, 3, 0, 0, 0, 0, time.UTC)},
		// ledger: 12,345 x 250 bps = 308.625 -> 309, 15% of 309 = 46.35 -> 46, fee 263 (Go amount-first: 262)
		{"12,345 fils at 250 bps, 1500 bps discount", 250, 1500, 12_345, 263, time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			merchantID := insertDiscountedMerchant(t, pool, tc.mdrBps, tc.discountBps)
			start, _ := BusinessDayWindow(tc.day)
			_, booked := insertBookedCapture(t, pool, merchantID, tc.mdrBps, tc.discountBps, tc.amount, start.Add(3*time.Hour))
			if booked != tc.wantFee || ledgerNet(t, pool, merchantID, "platform_fee_revenue") != int64(tc.wantFee) {
				t.Fatalf("fixture: booked fee %d, want %d", booked, tc.wantFee)
			}

			closed, err := CloseBatch(ctx, pool, merchantID, tc.day)
			if err != nil {
				t.Fatalf("CloseBatch: %v", err)
			}
			if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
				t.Fatalf("PayoutBatch: %v", err)
			}
			var feeFils, netPayout int64
			if err := pool.QueryRow(ctx, `SELECT fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1`, closed.BatchID).Scan(&feeFils, &netPayout); err != nil {
				t.Fatalf("read batch: %v", err)
			}
			if feeFils != int64(tc.wantFee) || netPayout != int64(tc.amount-tc.wantFee) {
				t.Errorf("batch fee_fils = %d, net_payout_fils = %d; want the ledger's booked fee %d and net %d", feeFils, netPayout, tc.wantFee, tc.amount-tc.wantFee)
			}
			if got := ledgerNet(t, pool, merchantID, "merchant_payable"); got != 0 {
				t.Errorf("merchant_payable after payout nets to %d, want 0 (nothing stranded)", got)
			}
		})
	}
}

// RecalculateMDR still re-prices at the merchant's current terms with ComputeSettlementFee; at
// unchanged terms it must agree with the booked fee and adjust nothing.
func TestRecalculateMDR_DiscountedMerchantUnchangedTermsAdjustsNothing(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertDiscountedMerchant(t, pool, 275, 1250)
	day := time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	insertBookedCapture(t, pool, merchantID, 275, 1250, 602, start.Add(time.Hour))
	if _, err := CloseBatch(ctx, pool, merchantID, day); err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	res, err := RecalculateMDR(ctx, pool, merchantID, day, day.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("RecalculateMDR: %v", err)
	}
	if len(res.Adjusted) != 0 {
		t.Errorf("RecalculateMDR at unchanged terms adjusted %+v, want nothing", res.Adjusted)
	}
}

// The created_at arm, exactly as ops/demo.sh box 3 does it: capture now (event and legs share
// now()), then re-date only the event's occurred_at 2 days back (the append-only ledger keeps
// today) and close that day. With the occurred_at match alone the booked fee was not found
// (fee 0), and merchant_payable kept the fee the batch never charged.
func TestCloseBatch_BookedFeeFoundAfterEventReDated(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertDiscountedMerchant(t, pool, 250, 1500)
	// As capture.ts does it: one DB transaction, every row dated now() (12,345 at 250 bps = 309, 15% off = 263).
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) // no-op after Commit
	var txnID uuid.UUID
	var now time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
		VALUES ($1, 'captured', 12345, 12345, $2) RETURNING id, now()
	`, merchantID, "acq-ref-"+uuid.New().String()).Scan(&txnID, &now); err != nil {
		t.Fatalf("transaction: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type) VALUES ($1, 'captured', 12345, 'system')`, txnID); err != nil {
		t.Fatalf("event: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES ($2, $3, $1, 'card_scheme_clearing', 'debit',  12345, now(), 'capture: gross'),
		       ($2, $3, $1, 'merchant_payable',     'credit', 12345, now(), 'capture: gross'),
		       ($2, $3, $1, 'merchant_payable',     'debit',  309,   now(), 'capture: MDR fee'),
		       ($2, $3, $1, 'platform_fee_revenue', 'credit', 309,   now(), 'capture: MDR fee'),
		       ($2, $3, $1, 'platform_fee_revenue', 'debit',  46,    now(), 'capture: negotiated discount adjustment'),
		       ($2, $3, $1, 'merchant_payable',     'credit', 46,    now(), 'capture: negotiated discount adjustment')
	`, txnID, uuid.New(), merchantID); err != nil {
		t.Fatalf("legs: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	booked := money.Fils(ledgerNet(t, pool, merchantID, "platform_fee_revenue"))
	// demo.sh box 3: re-date only the event; the append-only ledger keeps today.
	if _, err := pool.Exec(ctx, `UPDATE transaction_events SET occurred_at = occurred_at - interval '2 days' WHERE transaction_id = $1`, txnID); err != nil {
		t.Fatalf("re-date event: %v", err)
	}
	closed, err := CloseBatch(ctx, pool, merchantID, now.Add(-48*time.Hour).In(businessDayLocation)) // the re-dated event's Bahrain day
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if _, err := PayoutBatch(ctx, pool, closed.BatchID); err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if booked != 263 || closed.FeeFils != 263 {
		t.Errorf("booked %d, batch fee %d; want 263 for both", booked, closed.FeeFils)
	}
	if got := ledgerNet(t, pool, merchantID, "merchant_payable"); got != 0 {
		t.Errorf("merchant_payable after payout nets to %d, want 0", got)
	}
}

// The demo's netting shape (DEMO_SCRIPT: 10,000 captured, fee 225 booked at capture by the
// schedule/tier in force, a refund of 3,333 that reversed 75): net = 10,000 - 225 - (3,333 - 75)
// = 6,517. The merchant row still says 250 bps; CloseBatch must not re-price the capture at 250
// (which gave 6,492), and the refund side nets refunds.fee_reversed_fils, also a booked figure.
func TestCloseBatch_BookedFeeAndBookedRefundReversalNetTo6517(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)
	day := time.Date(2026, 6, 6, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(day)
	txnID, booked := insertCaptureEvent(t, pool, merchantID, 225, 10_000, start.Add(time.Hour))
	insertRefund(t, pool, merchantID, txnID, 3_333, 75, start.Add(2*time.Hour))
	res, err := CloseBatch(ctx, pool, merchantID, day)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if booked != 225 || res.FeeFils != 225 || res.NetPayoutFils != 6_517 {
		t.Errorf("booked %d, batch fee %d, net %d; want 225, 225, 6517", booked, res.FeeFils, res.NetPayoutFils)
	}
}
