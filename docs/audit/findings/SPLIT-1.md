### SPLIT-1 · Split children are rounded separately, so the remainder is lost (or invented) · F3, H2 · Severity: High
**What's wrong:** `PayoutSplitBatch` gave each sub-merchant `ApplyRateFils(net, weightBps)` independently (banker's rounding per child). The children's shares do not sum to the batch's net payout: fils are left behind on the parent or paid twice.

**Why it happens:** `apps/settlement/internal/splits/allocate.go:97` (`share := money.ApplyRateFils(money.Fils(netPayout), weightBps)`). Each child rounds on its own, and nothing hands out the difference. The TS side already has the correct largest-remainder `allocateRemainder` (packages/money/src/fils.ts:161), but the Go port never used it. `shares.go`'s `ChildShares` repeats the same per-child rounding, and its only test (`TestChildShares_SumToNet`) uses round amounts (10000 at 5000/5000, etc.) that never leave a remainder. Migration 0045 notes that the 10000-bps total is "enforced by whatever creates these rows", i.e. nothing.

**What it breaks:** net 100 fils at 3333/3333/3334 bps pays 33+33+33 = 99 fils: 1 fil per batch stays on the parent's merchant_payable and never reaches any child. Net 1,001 fils at the same weights rounds to 334+334+334 = 1,002 fils, 1 fil more than the batch owes. Weights that do not total 10000 silently pay the wrong share of the batch.

**Why it needed a fix:** split payouts must pay exactly the batch's net (F3/H2). Every batch with a remainder either strands money with the parent or overpays children, and the ledger drifts by that amount.

**Fix:** `allocate.go:97` + `:106-121` (+ `fmt`, `sort` imports)
```diff
-		share := money.ApplyRateFils(money.Fils(netPayout), weightBps)
+		share := money.Fils(netPayout * weightBps / 10_000) // floor; remainder handed out below (SPLIT-1)
 ...
+	// SPLIT-1 (F3, H2): largest-remainder split as packages/money allocateRemainder,
+	// so the children receive exactly netPayout; the weights must total 10000 bps.
+	leftover, sumBps := money.Fils(netPayout), int64(0)
+	order := make([]int, len(shares))
+	for i, s := range shares {
+		leftover, sumBps, order[i] = leftover-s.AllocatedFils, sumBps+s.WeightBps, i
+	}
+	if sumBps != 10_000 {
+		return SplitPayoutResult{}, fmt.Errorf("splits: PayoutSplitBatch: child weights total %d bps, want 10000", sumBps)
+	}
+	sort.SliceStable(order, func(a, b int) bool {
+		return netPayout*shares[order[a]].WeightBps%10_000 > netPayout*shares[order[b]].WeightBps%10_000
+	})
+	for k := 0; leftover > 0; k++ {
+		shares[order[k]].AllocatedFils++
+		leftover--
+	}
```
Commit: this commit. Lines: prod +21/-1, test +66/-0.

**Why this is the smallest correct fix:** it is the same algorithm as the TS `allocateRemainder` (floor each share, then give +1 fil to the largest remainders, ties by ascending index), applied in place where the shares are built and before any ledger leg is written. There is no new helper or signature change, and the posting loop is untouched. Because the weight denominator is fixed at 10000 bps, the TS decimal-scaling step is not needed. The 10000-bps check refuses a misconfigured parent instead of paying a wrong share (the transaction rolls back and nothing is paid). Why not round-to-nearest plus "dump the remainder on the last child": it is not TS-parity and is biased toward one child. Why not fix `ChildShares` in shares.go: it is not on the payout path (no production caller), so fixing it would not fix the payout. It is left as is and flagged.

**Proof:** `TestPayoutSplitBatch_SharesSumToNet` (splits/allocate_audit_test.go) failed before: `child at 3334 bps got 33 fils, want 34` and `children got 99 fils in total, want the full net payout 100`. It passes after. The splits, settlement and internalapi packages are green.

**Regression risk:** shares change by at most +1 fil per child, and only when a remainder exists. `totalAllocated` now equals `netPayout`, so `ApplyPayout` debits the full net (which resolves the "am: should pass netPayout here" drift note). A parent whose weights do not total 10000 bps now fails loudly instead of underpaying.

**Trap note:** `TestChildShares_SumToNet` used only remainder-free amounts, so the per-child rounding was never exercised. That test and `ChildShares` are left untouched (unused in production).
