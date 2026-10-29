### MDR-1 · MDR recalculation re-prices PAID batches in place · F5 · Severity: High
**What's wrong:** `RecalculateMDR` selected every batch with `status <> 'open'`, so `paid` batches were included. For each one it rewrote `settlement_batches.fee_fils` and `net_payout_fils` at the merchant's current flat rate and posted an adjustment against the already-paid batch.

**Why it happens:** `apps/settlement/internal/settlement/recalculate_mdr.go:67` `AND status <> 'open'`. The only statuses are `open`, `closed` and `paid` (migration 0006 CHECK), so this means "closed or paid". `:107-111` then UPDATEs the batch row. The doc comment (`:19-21`, "so the original batch's figures stay as they were paid") and the note at `:104` ("am: posts against the OLD batch id ... fixed in FP-244 i think") claimed paid history was safe; it was not.

**What it breaks:** a 10,000-fils capture at 250 bps closes with fee 250 and net 9,750 and is paid 9,750. After a rate change to 300 bps, recalculation sets the paid batch to fee 300 and net 9,700 and posts 50 fils against it. The bank instruction, the batch_closed webhook and the statement no longer match the stored row, and the ledger moves 50 fils off a batch that has already left.

**Why it needed a fix:** paid figures are an external record. Rewriting them breaks reconciliation with the bank and the merchant's statement (F5) and silently changes merchant balances for periods already settled.

**Fix:** `recalculate_mdr.go:67`
```diff
-		   AND status <> 'open'
+		   AND status = 'closed' -- MDR-1 (F5): never re-price a paid batch
```
and the misleading note at `:104` is replaced with `// MDR-1 (F5): only 'closed' (unpaid) batches get here; a paid batch is never re-priced.`
Commit: this commit. Lines: prod +2/-2 (1 code line, 1 comment line), test +39/-0.

**Why this is the smallest correct fix:** the single WHERE clause that admits paid batches. The `FOR UPDATE` on the same select locks the rows, so a batch cannot become paid between the scan and the UPDATE within this transaction. Why not add `AND status='closed'` to the UPDATE too: redundant under the row lock. Why not turn paid-batch corrections into current-period adjustments: that is a feature (a new posting path), not the minimal fix; the case file only requires paid batches not to be rewritten. Not addressed here (separate lead): the recomputation uses the flat `merchants.mdr_bps`, not the fee schedule or tier bonus that CloseBatch uses.

**Proof:** `TestRecalculateMDR_PaidBatchUntouched` (recalculate_mdr_audit_test.go) failed before: `adjusted 1 paid batch(es), want 0` and `paid batch fee_fils = 300, want unchanged 250`. It passes after. The existing `TestRecalculateMDR_*` tests (closed-only batches) still pass, and `go test ./internal/settlement/` is green.

**Regression risk:** closed-but-unpaid batches are recalculated exactly as before. Admin-triggered recalcs over paid periods now return zero adjustments; ops must post any agreed correction as a new adjustment. Data repair for past damage: restore paid batches' fee/net from their payout legs (ops-approved, not run here).

**Trap note:** the comments at recalculate_mdr.go:19-21 and :104 implied paid history was protected ("fixed in FP-244 i think"); the :104 note is replaced with the actual rule.
