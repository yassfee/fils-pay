### NET-1 · Net payout computed through float32 BD · FP-300 ☐3 · Severity: High
**What's wrong:** `NetPayableFils` converted gross and fee to float32 BD, subtracted, then scaled back and rounded, so the frozen `net_payout_fils` is not `gross - fee` on large batches (13 of 80 rows in `docs/exports/settlement-batches-2026-09-01_20.csv`).

**Why it happens:** `apps/settlement/internal/settlement/payable.go:11-12` (`float32(grossFils)/1000 - float32(feeFils)/1000`, then `math.Round(...*1000)`). float32 has a 24-bit significand, so above 8,192 BD neighbouring values are ≥0.98 fils apart. The faulty assumption ("BD only needs 2 decimals", quarantined cursorrules) contradicts the case file (1 BD = 1000 fils, integer fils). `TestCloseBatchNetPayoutIsWholeFils` (batch_test.go:480) used 13,333 fils, which is float32-exact, so it could never fail.

**What it breaks:** Delta Wholesale 2026-09-10: gross 22,696,171, fee 476,620 → stored 22,219,553 instead of 22,219,551 (overpaid 2 fils). Delta Marketplace 2026-09-05: 9,334,174 instead of 9,334,173. The same figure is the merchant_payable payout debit (batch.go:342), the split base, the settlement.paid amount and the disbursement amount, so `gross - fee - net` stays stuck on merchant_payable.

**Why it needed a fix:** every batch above 8,192 BD can pay the wrong amount, the error doubles with every binade (62.5 fils spacing at 524,288 BD), and the ledger never ties to the fil.

**Fix:** `payable.go:10`
```diff
 import (
-	"math"
-
 	"github.com/filspay/settlement/internal/money"
 )
 // NetPayableFils derives the net payout from frozen gross and fee totals.
+// Integer fils only (NET-1): a float32 BD round-trip loses fils above 8,192 BD.
 func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
-	netBD := float32(grossFils)/1000 - float32(feeFils)/1000
-	return money.Fils(math.Round(float64(netBD) * 1000))
+	return grossFils - feeFils
 }
```
Commit: this commit. Lines: prod +2/-4, test +25/-1.

**Why this is the smallest correct fix:** the single function every caller uses (batch.go:219) now does integer subtraction; signature unchanged. Why not float64: it would still be a float in money code, and the case file requires integer fils. Why not fix at batch.go:219: other callers would keep the float path. Historic paid batches are not rewritten here (correction journals are a separate, ops-approved step).

**Proof:** `TestNetPayableFilsIsExactGrossMinusFee` (payable_audit_test.go) failed before: `NetPayableFils(22696171, 476620) = 22219553, want 22219551`, `NetPayableFils(9564315, 230142) = 9334174, want 9334173`, `NetPayableFils(20893037, 438754) = 20454281, want 20454283`. It passes after; `go test ./internal/settlement/` is green.

**Regression risk:** only `CloseBatch` calls it; net now equals gross − fee exactly, which `apps/api/src/settlement/query.ts:50-52` already documents as the invariant. Covered by the settlement package tests (CloseBatch/PayoutBatch).

**Trap note:** the test comment "FH 2026-08-21: asked claude for an edge case, it said 13333 exercises the float rounding path" (batch_test.go:480) was false (13,333 is float32-exact); it now says so and points at the new test.
