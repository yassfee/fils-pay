package settlement

import "github.com/filspay/settlement/internal/money"

// ComputeSettlementFee computes the platform fee owed on one capture event,
// net of any negotiated per-merchant discount.
func ComputeSettlementFee(amountFils money.Fils, mdrBasisPoints, discountBasisPoints int64) money.Fils {
	fee := money.ApplyRateFils(amountFils, mdrBasisPoints) // FEES-5: fee-first, as capture.ts books it
	return fee - money.ApplyRateFils(fee, discountBasisPoints)
}
