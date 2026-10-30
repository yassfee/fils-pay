### YA-1 · The March residue sweep writes off "residue" for test-mode merchants that never reached the scheme · F2, G3, ADR-0002 · Severity: Low
**Lead:** Team 45 heads-up list (S6), verified by us.

**What's wrong:** `scripts/reconcile_march.ts` sweeps the scheme rounding residue of every March capture in `transactions`, including captures by sandbox (`test_mode = true`) merchants. A sandbox merchant is never settled, so none of its captures is ever exported to the scheme and there is no residue to write off. The sweep still posts a correction for it.

**Why it happens:** `fetchResidueRows` (`scripts/reconcile_march.ts:38-50`) selects `merchant_id, captured_fils FROM transactions WHERE captured_fils > 0 AND captured_fils % 10 <> 0` within the Bahrain month, with no merchant filter. Settlement itself only closes merchants with `status = 'active' AND test_mode = false` (`apps/settlement/internal/settlement/batch.go:121` and `:417`), and only closed batches get `scheme_export_lines`. So the set the sweep reads is wider than the set that ever produced a residue. `postResidueCorrection` (`:72-84`) then posts `merchant_payable` debit / `scheme_rounding_residue` credit for each merchant in that set.

**What it breaks:** a sandbox merchant with one March test capture of 1,005 fils (1.005 BD) gets a 5-fils write-off: its `merchant_payable` is debited 5 fils and `scheme_rounding_residue` is credited 5 fils. The scheme never saw that capture. Finance clears `scheme_rounding_residue` against the scheme statement each month (ADR-0002), so every sandbox capture adds fils to the ledger side that the statement can never match. That is one more source of the F1/F2 gap the sweep was meant to close. It is also G3 again ("test merchants keep showing up in the real settlement run"), in the settlement write-off this time.

**Why it needed a fix:** ADR-0002 defines the residue as `gross_fils - amount_fils` of an *exported* scheme line, and settlement never exports a sandbox merchant (`batch.go:121`). A ledger write-off for a residue that does not exist is a money error. The script has run in production at least once, and F2 asks whether it is safe to run again: after F2-SWEEP a second run skips merchants that were already swept, but a sandbox merchant that was not swept before would still be swept.

**Fix:** `scripts/reconcile_march.ts`
```diff
-async function fetchResidueRows(client: Client, year: number, month: number): Promise<ResidueRow[]> {
+export async function fetchResidueRows(client: Client, year: number, month: number): Promise<ResidueRow[]> {
 ...
         AND occurred_at >= $1 AND occurred_at < $2
+        AND merchant_id IN (SELECT id FROM merchants WHERE test_mode = false) -- S6: sandbox captures never reach the scheme
```
(`export` only makes the query testable.)

**Why this is the smallest correct fix:** one predicate, in the one query that chooses what gets swept, using the same `test_mode = false` rule settlement uses. *Why not read `scheme_export_lines` instead of `transactions`?* That would be closer to ADR-0002 (it would also drop captured-but-never-batched transactions), but it rewrites the query and changes the result for live merchants. That is a finance decision about a script that has already run, and it is listed below as an open question. *Why not filter in `groupByMerchant`?* That would still fetch the rows, and it is further from the cause.

**Proof:** `scripts/reconcile_march.audit.test.ts` "the March residue sweep skips test-mode merchants" seeds a `test_mode = true` merchant with a 1,005-fils capture on 15 March 2026 and calls `fetchResidueRows(client, 2026, 3)`. Before the fix it fails with `a sandbox capture has no scheme residue to sweep` (actual `[{ merchantId: '91af…', capturedFils: 1005 }]`, expected `[]`). After the fix it passes. All sweep tests pass, 5/5 (audit 2, unit 2, the 2,000-row integration stress test 1). `tsc -p scripts --noEmit` is clean.

**Regression risk:** live merchants are swept exactly as before. The filter reads the current flag. `test_mode` only ever goes from true to false (`apps/api/src/admin/merchantFlags.ts:16`), so a merchant that is still sandboxed is excluded. A merchant that went live after March is still swept in full, including its pre-go-live sandbox captures; only the per-line rewrite below would separate those. Still open for finance (not changed): the sweep works per transaction from `transactions.captured_fils`, while ADR-0002 works per exported line, so a March capture that was never batched is still swept.

Lines: prod +2/-1, test +25/-1
