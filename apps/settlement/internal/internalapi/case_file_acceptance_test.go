package internalapi

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/ledger"
	"github.com/filspay/settlement/internal/settlement"
)

// F4 / FP-203 (case file Pages 3 and 4): "The 'Recalculate cached balances'
// button in admin: I pressed it and Alpha Retail's balance went from 135K to
// 7K. Yousif had to run the CLI rebuild to fix it. Why do the button and the
// CLI give different numbers?" / "The two read from different places."
//
// Wired paths: the admin button (POST /v1/admin/balances/rebuild ->
// settlementClient.triggerBalanceRebuild -> POST /internal/rebuild-balances)
// and `settlement rebuild-balances` (no flag) both call
// ledger.RebuildAllBalances; `settlement rebuild-balances --merchant=<id>`
// calls ledger.RebuildMerchantBalance. The balance is the merchant's
// merchant_payable ledger position (credits - debits).
//
// RebuildAllBalances rewrites merchant_balances for EVERY merchant, which
// would reset caches other suites seed on the shared test DB, so that half
// only runs with CASEFILE_PLATFORM_REBUILD=1 (run it on an isolated DB).

func cfF4Ledger(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, txnID *uuid.UUID, at time.Time, legs ...any) {
	t.Helper()
	// legs: account, direction, amount triples, one balanced entry group in one statement
	args := []any{uuid.New(), merchantID, txnID, at}
	values := ""
	for i := 0; i < len(legs); i += 3 {
		n := len(args)
		if values != "" {
			values += ", "
		}
		values += fmt.Sprintf("($1, $2, $3, $%d, $%d, $%d::bigint, $4, 'case-file F4 fixture')", n+1, n+2, n+3)
		args = append(args, legs[i], legs[i+1], legs[i+2])
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description) VALUES `+values, args...); err != nil {
		t.Fatalf("insert ledger legs: %v", err)
	}
}

// cfF4Capture writes what capture.ts writes: the event, the gross legs and the MDR fee legs.
func cfF4Capture(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, gross, fee int64, at time.Time) uuid.UUID {
	t.Helper()
	txn := insertCaptureEvent(t, pool, merchantID, gross, at) // event + gross legs
	cfF4Ledger(t, pool, merchantID, &txn, at,
		"merchant_payable", "debit", fee,
		"platform_fee_revenue", "credit", fee)
	return txn
}

func cfF4Payable(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(sum(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::bigint
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&v); err != nil {
		t.Fatalf("ledger payable: %v", err)
	}
	return v
}

func cfF4Cache(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&v); err != nil {
		t.Fatalf("read cache: %v", err)
	}
	return v
}

func cfF4Corrupt(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils) VALUES ($1, 7000)
		ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = 7000
	`, merchantID); err != nil {
		t.Fatalf("set stale cache: %v", err)
	}
}

func TestCaseFile_F4(t *testing.T) {
	t.Run("F4/FP-203: the admin 'Recalculate cached balances' button and the CLI rebuild give different balances, now both give the ledger balance", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		bh := time.FixedZone("Asia/Bahrain", 3*60*60)
		m := insertActiveMerchant(t, pool) // "Alpha Retail", 250 bps

		// a settled and paid day: its scheme lines exist, its net already left merchant_payable
		cfF4Capture(t, pool, m, 100_000, 2_500, time.Date(2025, 4, 7, 10, 0, 0, 0, bh))
		cfF4Capture(t, pool, m, 35_555, 889, time.Date(2025, 4, 7, 16, 0, 0, 0, bh))
		day, _ := time.Parse("2006-01-02", "2025-04-07")
		if _, err := settlement.RunDailyBatch(ctx, pool, day, &m); err != nil {
			t.Fatalf("RunDailyBatch: %v", err)
		}
		// unsettled captures, a refund (processRefund.ts legs), an admin credit
		// (credits.ts legs) and an admin balance adjustment (ledgerAdjustments.ts legs)
		at := time.Date(2025, 4, 8, 11, 0, 0, 0, bh)
		txn := cfF4Capture(t, pool, m, 120_000, 3_000, at)
		cfF4Capture(t, pool, m, 15_123, 378, at.Add(time.Hour))
		cfF4Ledger(t, pool, m, &txn, at.Add(2*time.Hour),
			"merchant_payable", "debit", int64(5_000), "card_scheme_clearing", "credit", int64(5_000),
			"platform_fee_revenue", "debit", int64(125), "merchant_payable", "credit", int64(125))
		cfF4Ledger(t, pool, m, nil, at.Add(3*time.Hour),
			"merchant_credit_contra", "debit", int64(2_000), "merchant_payable", "credit", int64(2_000))
		cfF4Ledger(t, pool, m, nil, at.Add(4*time.Hour),
			"merchant_payable", "debit", int64(1_500), "manual_balance_adjustment_contra", "credit", int64(1_500))

		want := int64(120_000 - 3_000 + 15_123 - 378 - 5_000 + 125 + 2_000 - 1_500) // paid day nets to 0
		if got := cfF4Payable(t, pool, m); got != want {
			t.Fatalf("fixture: ledger merchant_payable %d, want %d", got, want)
		}
		var legsBefore int64
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, m).Scan(&legsBefore)

		// CLI: `settlement rebuild-balances --merchant=<id>` (scoped to this merchant)
		cfF4Corrupt(t, pool, m)
		cli, err := ledger.RebuildMerchantBalance(ctx, pool, m)
		if err != nil {
			t.Fatalf("RebuildMerchantBalance: %v", err)
		}
		if int64(cli) != want || cfF4Cache(t, pool, m) != want {
			t.Errorf("CLI --merchant rebuild: printed %d, cache %d, want the ledger balance %d", cli, cfF4Cache(t, pool, m), want)
		}
		var legsAfter int64
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1`, m).Scan(&legsAfter)
		if legsAfter != legsBefore {
			t.Errorf("rebuild changed the ledger: %d legs -> %d", legsBefore, legsAfter)
		}

		t.Run("platform-wide: admin button and full CLI rebuild agree with the ledger", func(t *testing.T) {
			if os.Getenv("CASEFILE_PLATFORM_REBUILD") != "1" {
				t.Skip("manual check: platform-wide rebuild, run on an isolated DB (CASEFILE_PLATFORM_REBUILD=1)")
			}
			// admin button -> POST /internal/rebuild-balances (the real handler)
			cfF4Corrupt(t, pool, m)
			resp := post(t, newTestServer(t, pool), "/internal/rebuild-balances", "Bearer "+testToken, "{}")
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("POST /internal/rebuild-balances: status %d", resp.StatusCode)
			}
			var body map[string]rebuildDiffResponse
			decodeJSON(t, resp, &body)
			button := body[m.String()]
			if button.After != want || cfF4Cache(t, pool, m) != want {
				t.Errorf("admin button: reported %d, cache %d, want the ledger balance %d", button.After, cfF4Cache(t, pool, m), want)
			}
			// `settlement rebuild-balances` with no flag
			cfF4Corrupt(t, pool, m)
			diffs, err := ledger.RebuildAllBalances(ctx, pool)
			if err != nil {
				t.Fatalf("RebuildAllBalances: %v", err)
			}
			if full := int64(diffs[m].Rebuilt); full != want || full != button.After || full != int64(cli) {
				t.Errorf("full CLI rebuild %d, admin button %d, CLI --merchant %d: want all equal to the ledger balance %d", full, button.After, cli, want)
			}
			if cfF4Cache(t, pool, m) != want {
				t.Errorf("full CLI rebuild left cache %d, want %d", cfF4Cache(t, pool, m), want)
			}
		})
	})
}
