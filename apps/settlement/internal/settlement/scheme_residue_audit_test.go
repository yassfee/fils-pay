package settlement

import (
	"context"
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// SCHEME-2 (F1/F2, ADR-0002): CloseBatch must journal each line's
// truncation residue (gross_fils - amount_fils) as card_scheme_clearing
// credit / scheme_rounding_residue debit, in the close transaction.
func TestCloseBatchJournalsSchemeRoundingResidue(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 25, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	for i, amount := range []money.Fils{4747, 4750} {
		insertCaptureEvent(t, pool, merchantID, mdrBps, amount, start.Add(time.Duration(i+1)*time.Hour))
	}
	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	exported := countRows(t, pool, `SELECT COALESCE(SUM(amount_fils), 0) FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID)
	wantResidue := int64(result.GrossFils) - int64(exported)
	if wantResidue != 7 {
		t.Fatalf("gross - exported = %d, want 7", wantResidue)
	}
	residueDebit := countRows(t, pool, `SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'scheme_rounding_residue' AND direction = 'debit'`, merchantID)
	clearingCredit := countRows(t, pool, `SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'card_scheme_clearing' AND direction = 'credit' AND description = 'scheme rounding residue'`, merchantID)
	if int64(residueDebit) != wantResidue || int64(clearingCredit) != wantResidue {
		t.Errorf("residue legs: scheme_rounding_residue debit %d, card_scheme_clearing credit %d, want %d each", residueDebit, clearingCredit, wantResidue)
	}
}
