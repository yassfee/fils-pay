package settlement

import (
	"github.com/filspay/settlement/internal/money"
)

// NetPayableFils derives the net payout from frozen gross and fee totals.
// Integer fils only (NET-1): a float32 BD round-trip loses fils above 8,192 BD.
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
