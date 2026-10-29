package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// NET-1 (FP-300): net payout must be exactly gross - fee in integer fils
// (case file: 1 BD = 1000 fils, integer money). Rows from
// docs/exports/settlement-batches-2026-09-01_20.csv that the float32 path got wrong.
func TestNetPayableFilsIsExactGrossMinusFee(t *testing.T) {
	cases := []struct{ gross, fee, want money.Fils }{
		{22_696_171, 476_620, 22_219_551}, // Delta Wholesale 2026-09-10 (stored 22_219_553)
		{9_564_315, 230_142, 9_334_173},   // Delta Marketplace 2026-09-05 (stored 9_334_174)
		{20_893_037, 438_754, 20_454_283},
		{13_333, 333, 13_000},
	}
	for _, c := range cases {
		if got := NetPayableFils(c.gross, c.fee); got != c.want {
			t.Errorf("NetPayableFils(%d, %d) = %d, want %d", c.gross, c.fee, got, c.want)
		}
	}
}
