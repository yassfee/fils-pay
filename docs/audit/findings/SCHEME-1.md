### SCHEME-1 · Scheme amount is the untruncated gross rounded half-up by NUMERIC(10,2) · F1, ADR-0002 · Severity: High
**What's wrong:** CloseBatch writes `scheme_export_lines.amount` (the figure the scheme file carries) from the untruncated gross, so Postgres `NUMERIC(10,2)` rounds it half-up while `amount_fils` holds the truncated value. The statement is "always over, never under".

**Why it happens:** `apps/settlement/internal/settlement/batch.go:255` passed `SchemeAmountBD(line.grossFils)` (float64 gross/1000) instead of the `truncated` value computed on the line above. `LoadSchemeExportLines` (scheme_export.go:71) prefers `amount` over `amount_fils`, so the file quotes the rounded figure. The test `TestSchemeExportAmountHasTwoDecimals` only checked the format with a regex; its comment "am: 4747 -> "4.75" passes the regex ... it rounds. whatever" waved the bug through.

**What it breaks:** 4,747 fils exports as 4.75 BD (claims 3 fils more than captured); 1,005 fils exports as 1.01 BD (+5 fils). For the test batch of 4,747 + 1,005 + 4,740 + 12,344 fils, the file claims 22.83 BD, while ADR-0002 truncation gives 22.82 BD and `amount_fils` sums to 22,820. Up to 5 fils per line is claimed from the scheme that was never captured, and the file disagrees with `amount_fils`.

**Why it needed a fix:** ADR-0002 (trusted) says to truncate each line to a multiple of 10 fils and journal the residue. Rounding up over-claims from the card scheme on every line ending in 5-9 fils, and the scheme report never reconciles with the ledger.

**Fix:** `batch.go:254-255`
```diff
-			VALUES ($1, $2, $3, $4, $5)
-		`, batchID, line.transactionID, int64(truncated), SchemeAmountBD(line.grossFils), i+1)
+			VALUES ($1, $2, $3, $3::bigint::numeric / 1000, $4)
+		`, batchID, line.transactionID, int64(truncated), i+1) // ADR-0002: truncated amount, never rounded gross
```
Commit: this commit. Lines: prod +2/-2, test +49/-1.

**Why this is the smallest correct fix:** one INSERT now derives `amount` from the same truncated `amount_fils`, exactly and float-free (integer → numeric division in SQL). Why not `SchemeAmountBD(truncated)`: still a float in money code, against the case file. Why not drop the `amount` column or rewrite `LoadSchemeExportLines`: a larger diff, and other readers (migration 0050, views) use `amount`. `SchemeAmountBD` is now unused but left in place to keep the diff minimal (safe to delete later). Rows already written need the data repair `UPDATE scheme_export_lines SET amount = amount_fils::numeric/1000 WHERE amount <> amount_fils::numeric/1000` (ops-approved, not run here).

**Proof:** `TestSchemeExportAmountIsTruncatedFils` (scheme_export_audit_test.go) failed before: `amount = "4.75" for amount_fils 4740, want "4.74"` and `amount = "1.01" for amount_fils 1000, want "1.00"`. It passes after; `go test ./internal/settlement/` is green.

**Regression risk:** only the scheme_export_lines INSERT changes. The CHECK `amount_fils % 10 = 0` still holds (unchanged arg). The format test `TestSchemeExportAmountHasTwoDecimals` still passes ("4.74" matches `\d+\.\d{2}`). The residue (gross − truncated) is journaled by SCHEME-2.

**Trap note:** the test comment in scheme_export_test.go:18 ("is 4.75 right for 4747 fils?? it rounds. whatever, scheme wants 2dp") and YA's unanswered question in scheme_export.go:21 ("where does the third go?") are the cover. The test comment is now corrected to cite ADR-0002 and the new test.
