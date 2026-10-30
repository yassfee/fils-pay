package settlement

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// Case-file acceptance scenarios (lane J, Go settlement side). Each test
// reproduces one complaint from handoff/01_CASE_FILE_TRANSCRIPT.md (Pages 3
// and 4) end to end against a real, migrated Postgres, through the entry
// point the daemon / `settlement run-batch` CLI actually call
// (RunDailyBatch, ExportSchemeFile, RecalculateMDR,
// EnqueuePayoutNotifications), and checks the behaviour the case file asks
// for. Every scenario creates its own merchants and uses its own 2025
// business day, so it never closes a day for anyone else's merchants.

// cfDay is the business date exactly as `settlement run-batch --date=` and
// the internal admin run-batch endpoint parse it (UTC midnight of the date).
func cfDay(t *testing.T, ymd string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", ymd)
	if err != nil {
		t.Fatalf("parse %s: %v", ymd, err)
	}
	return d
}

// cfBahrain returns a wall-clock instant in Asia/Bahrain (UTC+3).
func cfBahrain(y int, m time.Month, d, hh, mm, ss int) time.Time {
	return time.Date(y, m, d, hh, mm, ss, 0, time.FixedZone("Asia/Bahrain", 3*60*60))
}

func cfMerchant(t *testing.T, pool *pgxpool.Pool, name string, mdrBps int64, testMode bool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, $2, 'active', $3) RETURNING id
	`, "case-file-"+name+"-"+uuid.New().String(), mdrBps, testMode).Scan(&id); err != nil {
		t.Fatalf("insert merchant %s: %v", name, err)
	}
	return id
}

// cfRunDay runs the daily close + payout for one merchant and one business
// day through RunDailyBatch (what `run-batch --merchant=` and the daemon call).
func cfRunDay(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, day time.Time) MerchantBatchOutcome {
	t.Helper()
	report, err := RunDailyBatch(context.Background(), pool, day, &merchantID)
	if err != nil {
		t.Fatalf("RunDailyBatch(%s): %v", day.Format("2006-01-02"), err)
	}
	if len(report.MerchantResults) != 1 {
		t.Fatalf("RunDailyBatch(%s) processed %d merchants, want 1", day.Format("2006-01-02"), len(report.MerchantResults))
	}
	return report.MerchantResults[0]
}

func cfInt64(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", query, err)
	}
	return v
}

// cfSchemeFils parses one scheme-file amount ("D.DD" BD) into integer fils.
func cfSchemeFils(t *testing.T, amount string) int64 {
	t.Helper()
	whole, frac, ok := strings.Cut(amount, ".")
	if !ok || len(frac) != 2 {
		t.Fatalf("scheme amount %q is not a two-decimal BD figure", amount)
	}
	w, err1 := strconv.ParseInt(whole, 10, 64)
	f, err2 := strconv.ParseInt(frac, 10, 64)
	if err1 != nil || err2 != nil {
		t.Fatalf("scheme amount %q does not parse", amount)
	}
	return w*1000 + f*10
}

// F1: "The scheme statement total is always a few fils higher than ours.
// It's always over, never under." ADR-0002: each scheme line is truncated
// to a multiple of 10 fils and the residue is journaled, so the scheme file
// is never over, and scheme file + journaled residue == our ledger total.
func TestCaseFile_F1(t *testing.T) {
	t.Run("F1: scheme statement total always a few fils over ours, now the file is truncated per line and file + journaled residue == our ledger total", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		const mdr = 225
		m := cfMerchant(t, pool, "f1-scheme", mdr, false)
		at := cfBahrain(2025, 2, 3, 14, 0, 0)
		gross := map[string]int64{} // acquirer_reference -> our captured gross that day
		var ourTotal int64
		for i, amt := range []money.Fils{4755, 1001, 9999, 12345, 250, 87_659} {
			txn, _ := insertCaptureEvent(t, pool, m, mdr, amt, at.Add(time.Duration(i)*time.Minute))
			ourTotal += int64(amt)
			var ref string
			_ = pool.QueryRow(ctx, `SELECT acquirer_reference FROM transactions WHERE id = $1`, txn).Scan(&ref)
			gross[ref] = int64(amt)
		}
		// one order captured in two parts the same day: one scheme line of 6,667 fils
		txn, _ := insertCaptureEvent(t, pool, m, mdr, 3333, at.Add(time.Hour))
		insertAdditionalCaptureEvent(t, pool, m, txn, mdr, 3334, at.Add(2*time.Hour))
		var ref string
		_ = pool.QueryRow(ctx, `SELECT acquirer_reference FROM transactions WHERE id = $1`, txn).Scan(&ref)
		gross[ref] = 6667
		ourTotal += 6667

		out := cfRunDay(t, pool, m, cfDay(t, "2025-02-03"))
		if int64(out.GrossFils) != ourTotal {
			t.Fatalf("batch gross %d fils, want our captured total %d", out.GrossFils, ourTotal)
		}
		path := filepath.Join(t.TempDir(), "scheme.csv")
		if _, err := ExportSchemeFile(ctx, pool, out.BatchID, path); err != nil {
			t.Fatalf("ExportSchemeFile: %v", err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read scheme file: %v", err)
		}
		var fileTotal int64
		lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
		for _, line := range lines {
			cols := strings.Split(line, ",")
			if len(cols) != 4 {
				t.Fatalf("scheme line %q has %d columns, want 4", line, len(cols))
			}
			amt := cfSchemeFils(t, cols[1])
			g, ok := gross[cols[0]]
			if !ok {
				t.Fatalf("scheme line %q is not one of this merchant's captures", line)
			}
			if amt > g {
				t.Errorf("scheme line %s carries %d fils, OVER our captured %d", cols[0], amt, g)
			}
			if want := g / 10 * 10; amt != want {
				t.Errorf("scheme line %s carries %d fils, want %d (truncated to 10 fils, ADR-0002)", cols[0], amt, want)
			}
			fileTotal += amt
		}
		if len(lines) != len(gross) {
			t.Errorf("scheme file has %d lines, want one per transaction (%d)", len(lines), len(gross))
		}
		if fileTotal > ourTotal {
			t.Errorf("scheme file total %d fils is OVER our ledger total %d", fileTotal, ourTotal)
		}
		residue := ledgerNet(t, pool, m, "scheme_rounding_residue") // debit-normal: net is negative
		if fileTotal+(-residue) != ourTotal {
			t.Errorf("scheme file %d + journaled residue %d = %d fils, want our ledger total %d", fileTotal, -residue, fileTotal-residue, ourTotal)
		}
		capturedGross := cfInt64(t, pool, `SELECT COALESCE(sum(amount_fils),0)::bigint FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'card_scheme_clearing' AND direction = 'debit'`, m)
		if capturedGross != ourTotal {
			t.Errorf("ledger captured gross %d, want %d", capturedGross, ourTotal)
		}
		if clearing := -ledgerNet(t, pool, m, "card_scheme_clearing"); clearing != fileTotal {
			t.Errorf("card_scheme_clearing balance %d fils, want the scheme file total %d (what the scheme will actually settle)", clearing, fileTotal)
		}
	})
}

// F3 / H2: "Split payouts for Delta Marketplace: the three child payouts
// don't add up to the parent's total ... every batch" / "the settlement
// splits are always a few fils short". Every batch's child payouts must sum
// exactly to the parent's net payout, and no fils may be left anywhere.
func TestCaseFile_F3(t *testing.T) {
	t.Run("F3/H2: Delta Marketplace child payouts fall a few fils short of the parent total every batch, now they add up exactly", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		const mdr = 225
		parent := cfMerchant(t, pool, "delta-marketplace", mdr, false)
		weights := []int64{5000, 3000, 2000} // Delta Marketplace's three children (db/seed/fixtures/merchants.ts)
		for i, w := range weights {
			child := cfMerchant(t, pool, "delta-child-"+strconv.Itoa(i), mdr, false)
			if _, err := pool.Exec(ctx, `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps) VALUES ($1, $2, $3)`, parent, child, w); err != nil {
				t.Fatalf("insert split child: %v", err)
			}
		}
		days := []string{"2025-02-10", "2025-02-11", "2025-02-12"}
		amounts := [][]money.Fils{{12_347, 8_889, 101_013}, {7_777, 33_331, 999}, {45_673, 1_234, 56_789, 3}}
		for i, ymd := range days {
			day := cfDay(t, ymd)
			for j, amt := range amounts[i] {
				insertCaptureEvent(t, pool, parent, mdr, amt, cfBahrain(day.Year(), day.Month(), day.Day(), 10+j, 7, 0))
			}
			out := cfRunDay(t, pool, parent, day)
			net := cfInt64(t, pool, `SELECT net_payout_fils FROM settlement_batches WHERE id = $1 AND status = 'paid'`, out.BatchID)
			if net <= 0 {
				t.Fatalf("%s: batch net %d, want a positive paid batch", ymd, net)
			}
			rows, err := pool.Query(ctx, `SELECT split_weight_bps, allocated_fils FROM settlement_batch_splits WHERE settlement_batch_id = $1`, out.BatchID)
			if err != nil {
				t.Fatalf("query splits: %v", err)
			}
			var childSum int64
			n := 0
			for rows.Next() {
				var w, got int64
				if err := rows.Scan(&w, &got); err != nil {
					t.Fatalf("scan split: %v", err)
				}
				if lo := net * w / 10_000; got != lo && got != lo+1 {
					t.Errorf("%s: child at %d bps got %d fils, want its proportional share %d or %d", ymd, w, got, lo, lo+1)
				}
				childSum += got
				n++
			}
			rows.Close()
			if n != len(weights) {
				t.Errorf("%s: %d child payouts, want %d", ymd, n, len(weights))
			}
			if childSum != net {
				t.Errorf("%s: child payouts add up to %d fils, want the parent's total %d (%d fils lost)", ymd, childSum, net, net-childSum)
			}
			paidOut := cfInt64(t, pool, `SELECT COALESCE(sum(amount_fils),0)::bigint FROM ledger_entries WHERE settlement_batch_id = $1 AND account_id = 'platform_cash' AND direction = 'credit'`, out.BatchID)
			if paidOut != net {
				t.Errorf("%s: ledger paid out %d fils, want %d", ymd, paidOut, net)
			}
		}
		if left := ledgerNet(t, pool, parent, "merchant_payable"); left != 0 {
			t.Errorf("parent merchant_payable still holds %d fils after every batch was paid, want 0 (no fils stranded)", left)
		}
	})
}

// F5: "MDR recalculation changed batches that were already paid out. Those
// should never change." A paid batch's figures and ledger stay untouched
// by RecalculateMDR (what the admin /internal/recalculate-mdr call runs).
func TestCaseFile_F5(t *testing.T) {
	t.Run("F5: MDR recalculation changed batches already paid out, now a paid batch never changes", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		m := cfMerchant(t, pool, "f5-mdr", 250, false)
		insertCaptureEvent(t, pool, m, 250, 100_003, cfBahrain(2025, 2, 17, 9, 0, 0))
		insertCaptureEvent(t, pool, m, 250, 49_999, cfBahrain(2025, 2, 17, 18, 30, 0))
		paid := cfRunDay(t, pool, m, cfDay(t, "2025-02-17"))
		// a later day is closed but not yet paid out
		insertCaptureEvent(t, pool, m, 250, 50_001, cfBahrain(2025, 2, 18, 9, 0, 0))
		if _, err := CloseBatch(ctx, pool, m, cfDay(t, "2025-02-18")); err != nil {
			t.Fatalf("CloseBatch: %v", err)
		}

		type snap struct {
			status           string
			gross, fee, net  int64
			refundG, refundF int64
			paidAt, closedAt string
			legs, legSum     int64
		}
		read := func() (s snap) {
			if err := pool.QueryRow(ctx, `SELECT status, gross_fils, fee_fils, net_payout_fils, refund_gross_fils, refund_fee_reversed_fils, paid_at::text, closed_at::text FROM settlement_batches WHERE id = $1`, paid.BatchID).
				Scan(&s.status, &s.gross, &s.fee, &s.net, &s.refundG, &s.refundF, &s.paidAt, &s.closedAt); err != nil {
				t.Fatalf("read paid batch: %v", err)
			}
			if err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount_fils),0)::bigint FROM ledger_entries WHERE settlement_batch_id = $1`, paid.BatchID).Scan(&s.legs, &s.legSum); err != nil {
				t.Fatalf("read paid batch legs: %v", err)
			}
			return s
		}
		before := read()
		if before.status != "paid" {
			t.Fatalf("batch status %q, want paid", before.status)
		}

		// the merchant's contract rate changes, then finance runs the recalculation over both days
		if _, err := pool.Exec(ctx, `UPDATE merchants SET mdr_bps = 300 WHERE id = $1`, m); err != nil {
			t.Fatalf("change mdr: %v", err)
		}
		res, err := RecalculateMDR(ctx, pool, m, cfDay(t, "2025-02-17"), cfDay(t, "2025-02-19"))
		if err != nil {
			t.Fatalf("RecalculateMDR: %v", err)
		}
		for _, a := range res.Adjusted {
			if a.BatchID == paid.BatchID {
				t.Errorf("RecalculateMDR adjusted the paid batch (fee %d -> %d)", a.OldFeeFils, a.NewFeeFils)
			}
		}
		if after := read(); after != before {
			t.Errorf("paid batch changed after MDR recalculation:\n before %+v\n after  %+v", before, after)
		}
		if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND description = 'MDR recalculation adjustment'`, paid.BatchID); n != 0 {
			t.Errorf("%d MDR adjustment legs posted against the paid batch, want 0", n)
		}
	})
}

// G1 / H5: "The daily close is running at 3am local, not midnight" / "the
// daily close timing doesn't match what the docs say". The business day is
// midnight to midnight Asia/Bahrain: a capture belongs to the batch of its
// Bahrain calendar date, whether the date comes from the daemon (a Bahrain
// midnight) or from `run-batch --date=` (a parsed UTC date).
func TestCaseFile_G1(t *testing.T) {
	t.Run("G1/H5: daily close cut at 3am local / the UTC day, now each batch covers midnight-to-midnight Asia/Bahrain", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		m := cfMerchant(t, pool, "g1-window", 250, false)
		add := func(amt money.Fils, at time.Time) { insertCaptureEvent(t, pool, m, 250, amt, at) }
		add(1_001, cfBahrain(2025, 2, 23, 23, 59, 59)) // D-1, last second
		add(2_002, cfBahrain(2025, 2, 24, 0, 0, 0))    // D, first second (21:00 UTC on D-1)
		add(3_003, cfBahrain(2025, 2, 24, 2, 59, 59))  // D, before 3am local (still D-1 in UTC)
		add(4_004, cfBahrain(2025, 2, 24, 23, 59, 59)) // D, last second
		add(5_005, cfBahrain(2025, 2, 25, 0, 0, 0))    // D+1, first second (still D in UTC)
		add(6_006, cfBahrain(2025, 2, 25, 2, 59, 59))  // D+1, before 3am local

		// the daemon passes the Bahrain midnight of the completed day
		daemonDay := cfBahrain(2025, 2, 24, 0, 0, 0).In(businessDayLocation)
		d := cfRunDay(t, pool, m, daemonDay)
		if d.GrossFils != 2_002+3_003+4_004 {
			t.Errorf("batch for 2025-02-24 (daemon) has gross %d fils, want %d (00:00-24:00 Asia/Bahrain)", d.GrossFils, 2_002+3_003+4_004)
		}
		// an operator backfills the neighbours with run-batch --date=
		if next := cfRunDay(t, pool, m, cfDay(t, "2025-02-25")); next.GrossFils != 5_005+6_006 {
			t.Errorf("batch for 2025-02-25 (CLI) has gross %d fils, want %d", next.GrossFils, 5_005+6_006)
		}
		if prev := cfRunDay(t, pool, m, cfDay(t, "2025-02-23")); prev.GrossFils != 1_001 {
			t.Errorf("batch for 2025-02-23 (CLI) has gross %d fils, want %d", prev.GrossFils, 1_001)
		}
		var batchDate time.Time
		if err := pool.QueryRow(ctx, `SELECT batch_date FROM settlement_batches WHERE id = $1`, d.BatchID).Scan(&batchDate); err != nil {
			t.Fatalf("read batch date: %v", err)
		}
		if got := batchDate.Format("2006-01-02"); got != "2025-02-24" {
			t.Errorf("batch_date %s, want 2025-02-24", got)
		}
		if n := countRows(t, pool, `SELECT count(*) FROM transaction_events te JOIN transactions t ON t.id = te.transaction_id WHERE t.merchant_id = $1 AND te.settlement_batch_id IS NULL`, m); n != 0 {
			t.Errorf("%d capture(s) left in no batch, want 0", n)
		}
	})
}

// G2: "Lifetime payout estimate drifts for high-volume merchants". The
// running total PayoutBatch keeps must equal the exact sum of the merchant's
// payouts in fils, however large it grows.
func TestCaseFile_G2(t *testing.T) {
	t.Run("G2: lifetime payout estimate drifts for high-volume merchants, now it equals the exact sum of payouts", func(t *testing.T) {
		pool := mustPool(t)
		m := cfMerchant(t, pool, "g2-high-volume", 225, false)
		var paidSum int64
		for i, ymd := range []string{"2025-03-03", "2025-03-04", "2025-03-05", "2025-03-06"} {
			day := cfDay(t, ymd)
			for j, amt := range []money.Fils{7_654_321, 9_876_543, 1, 3_333_337} {
				insertCaptureEvent(t, pool, m, 225, amt+money.Fils(i), cfBahrain(day.Year(), day.Month(), day.Day(), 8+j, 0, 0))
			}
			out := cfRunDay(t, pool, m, day)
			paidSum += int64(out.NetPayoutFils)
		}
		if paidSum <= 1<<24 {
			t.Fatalf("scenario too small: %d fils paid", paidSum)
		}
		ledgerPaid := cfInt64(t, pool, `SELECT COALESCE(sum(amount_fils),0)::bigint FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'platform_cash' AND direction = 'credit'`, m)
		if ledgerPaid != paidSum {
			t.Fatalf("ledger paid %d, batches paid %d", ledgerPaid, paidSum)
		}
		est := cfInt64(t, pool, `SELECT lifetime_net_payout_monitoring_estimate::bigint FROM merchants WHERE id = $1`, m)
		if est != paidSum {
			t.Errorf("lifetime payout estimate %d fils, want the exact payout total %d (drift %d)", est, paidSum, est-paidSum)
		}
	})
}

// G3 / H7 (settlement part): "Test merchants keep showing up in the real
// settlement run" / "what happens to test merchants when certain admin tools
// run?". A test-mode merchant's captures are never closed, exported or paid
// out, even when the run is pointed at it by id (`run-batch --merchant=`, the
// admin run-batch endpoint); a live merchant the same day is settled.
func TestCaseFile_G3(t *testing.T) {
	t.Run("G3/H7: test merchants show up in the real settlement run, now a test-mode merchant is never settled or paid", func(t *testing.T) {
		pool := mustPool(t)
		ctx := context.Background()
		day := cfDay(t, "2025-03-10")
		sandbox := cfMerchant(t, pool, "g3-sandbox", 250, true)
		live := cfMerchant(t, pool, "g3-live", 250, false)
		insertCaptureEvent(t, pool, sandbox, 250, 77_777, cfBahrain(2025, 3, 10, 12, 0, 0))
		insertCaptureEvent(t, pool, live, 250, 11_111, cfBahrain(2025, 3, 10, 12, 0, 0))

		report, err := RunDailyBatch(ctx, pool, day, &sandbox)
		if err != nil {
			t.Fatalf("RunDailyBatch(sandbox): %v", err)
		}
		if len(report.MerchantResults) != 0 {
			t.Errorf("settlement run processed the test merchant: %+v", report.MerchantResults)
		}
		if n := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1`, sandbox); n != 0 {
			t.Errorf("%d settlement batch(es) for the test merchant, want 0", n)
		}
		if n := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE merchant_id = $1 AND settlement_batch_id IS NOT NULL`, sandbox); n != 0 {
			t.Errorf("%d payout ledger leg(s) for the test merchant, want 0", n)
		}
		if n := countRows(t, pool, `SELECT count(*) FROM transaction_events te JOIN transactions t ON t.id = te.transaction_id WHERE t.merchant_id = $1 AND te.settlement_batch_id IS NOT NULL`, sandbox); n != 0 {
			t.Errorf("%d test-merchant capture(s) batched, want 0", n)
		}
		if out := cfRunDay(t, pool, live, day); out.GrossFils != 11_111 || out.NetPayoutFils <= 0 {
			t.Errorf("live merchant batch gross %d net %d, want gross 11111 and a payout", out.GrossFils, out.NetPayoutFils)
		}
	})
}

// INCIDENT 2026-08-21: "Shops got two 'your payout is on the way' messages
// for the same payout. Two processes checked at the same time, and both
// thought they were first." The daemon and `run-batch` running the same day
// at the same moment must pay once and notify once.
func TestCaseFile_INC20260821(t *testing.T) {
	t.Run("INCIDENT 2026-08-21: two processes notifying the same payout at once sent two messages, now exactly one", func(t *testing.T) {
		poolA := mustPool(t)
		ctx := context.Background()
		poolB, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
		if err != nil {
			t.Fatalf("second process pool: %v", err)
		}
		defer poolB.Close()
		drain := func() {
			for i := 0; i < 50; i++ {
				n, err := EnqueuePayoutNotifications(ctx, poolA)
				if err != nil {
					t.Fatalf("EnqueuePayoutNotifications: %v", err)
				}
				if n == 0 {
					return
				}
			}
		}
		drain() // older backlog first, so both processes race on this payout

		for round, ymd := range []string{"2025-03-17", "2025-03-18", "2025-03-19", "2025-03-20", "2025-03-21"} {
			day := cfDay(t, ymd)
			m := cfMerchant(t, poolA, "inc0821-"+strconv.Itoa(round), 250, false)
			insertCaptureEvent(t, poolA, m, 250, 25_005, cfBahrain(day.Year(), day.Month(), day.Day(), 11, 0, 0))

			// each "process" does what `run-batch --date= --merchant=` does: close+pay, then notify
			start := make(chan struct{})
			var wg sync.WaitGroup
			errs := make(chan error, 8)
			for p := 0; p < 8; p++ {
				pool := poolA
				if p%2 == 1 {
					pool = poolB
				}
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					if _, err := RunDailyBatch(ctx, pool, day, &m); err != nil {
						errs <- err
						return
					}
					if _, err := EnqueuePayoutNotifications(ctx, pool); err != nil {
						errs <- err
					}
				}()
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				t.Errorf("%s: concurrent run failed: %v", ymd, err)
			}
			drain()

			var batchID uuid.UUID
			if err := poolA.QueryRow(ctx, `SELECT id FROM settlement_batches WHERE merchant_id = $1 AND status = 'paid'`, m).Scan(&batchID); err != nil {
				t.Fatalf("%s: want exactly one paid batch: %v", ymd, err)
			}
			if n := countRows(t, poolA, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1 AND account_id = 'platform_cash'`, batchID); n != 1 {
				t.Errorf("%s: %d payout leg(s), want 1 (paid once)", ymd, n)
			}
			if n := countRows(t, poolA, `SELECT count(*) FROM outbox_events WHERE event_type = 'settlement.paid' AND aggregate_id = $1`, batchID); n != 1 {
				t.Errorf("%s: %d 'your payout is on the way' notification(s) for one payout, want exactly 1", ymd, n)
			}
		}
	})
}
