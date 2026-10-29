### SCHEME-2 · ADR-0002 truncation residue is never journaled at close · F1, F2, ADR-0002 · Severity: High
**What's wrong:** CloseBatch truncates every scheme line to a multiple of 10 fils, but the difference (gross − amount_fils) is never posted to the ledger, so the ledger cannot tie to the scheme file.

**Why it happens:** `apps/settlement/internal/settlement/batch.go:250-258`: the line loop inserts `scheme_export_lines` and moves on. ADR-0002's "Implementation notes" claim the residue is "implemented inside CloseBatch alongside the scheme_export_lines insert (March 2026)", and "no month-end sweep is needed from April onwards", but no code posts it (`grep scheme_rounding_residue apps/settlement` found only the chart-of-accounts seed in migration 0007). YA's comment at scheme_export.go:21 ("where does the third go? asked twice. told to leave it") is the unanswered question.

**What it breaks:** a 4,747-fils capture is exported as 4,740 fils; the 7 fils never appear in `card_scheme_clearing` / `scheme_rounding_residue`. Across a month this is a few BD per busy merchant (ADR-0002 context) that finance cannot reconcile against the scheme statement, and nobody runs the month-end sweep because the ADR says it is no longer needed.

**Why it needed a fix:** the case file (F1/F2) and ADR-0002 Option A require one balanced residue group per line at export. Without it the clearing account drifts from the scheme settlement by the sum of the residues, forever.

**Fix:** `batch.go:259-265` (inside the line loop, same transaction as the export line)
```diff
+		if residue := line.grossFils - truncated; residue > 0 { // ADR-0002: journal the truncation residue
+			_, err = tx.Exec(ctx, `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
+				VALUES ($1, $2, $3, 'card_scheme_clearing', 'credit', $4, now(), 'scheme rounding residue'), ($1, $2, $3, 'scheme_rounding_residue', 'debit', $4, now(), 'scheme rounding residue')`, uuid.New(), merchantID, line.transactionID, int64(residue))
+			if err != nil {
+				return BatchResult{}, fmt.Errorf("settlement: CloseBatch: journal scheme residue: %w", err)
+			}
+		}
```
Commit: this commit. Lines: prod +7/-0, test +37/-0.

**Why this is the smallest correct fix:** one balanced two-leg group per line, posted exactly where `truncated` is computed and inside the close transaction (so the batch and its residue commit or roll back together; the deferred balance trigger in 0007 checks the group). Legs match the ADR-0002 table (card_scheme_clearing credit, scheme_rounding_residue debit). `settlement_batch_id` is left NULL (the line is linked by `transaction_id`) so the existing "exactly 2 payout legs per batch" assertions stay valid. Why not a month-end sweep: ADR-0002 rejected it (Option A chosen). Why not one group per batch: ADR-0002 asks for per-line auditability. Historic batches (April onwards) need a one-off correction journal, which is ops-approved and not done here.

**Proof:** `TestCloseBatchJournalsSchemeRoundingResidue` (scheme_residue_audit_test.go) failed before: `residue legs: scheme_rounding_residue debit 0, card_scheme_clearing credit 0, want 7 each`. It passes after; the settlement, ledger and internalapi packages are green.

**Regression risk:** adds ledger rows only for lines whose gross is not a multiple of 10 fils. merchant_payable is untouched, so payouts and balances are unaffected. Covered by the settlement/ledger/internalapi package tests.

**Trap note:** ADR-0002's own "Implementation notes" say this is already implemented in CloseBatch; it was not. This note records the false claim. Depends on SCHEME-1 (the file amount must be exactly amount_fils/1000 for the residue to be right).
