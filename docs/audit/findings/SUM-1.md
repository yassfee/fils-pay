### SUM-1 · Settlement summary sums the running captured total once per capture event · H6, FP-300 ☐5 · Severity: High

**What's wrong:** `GET /v1/settlement/summary` returns `totalCapturedFils = SUM(t.captured_fils)` over a join with one row per capture event, so a transaction captured in k parts is counted k times its final cumulative total, and the figure uses today's running total instead of what was captured inside the window.

**Why it happens:** `apps/api/src/settlement/query.ts:366-379`: the `captured` CTE joins `transactions` (1 row) to `transaction_events` (k rows) and carries `t.captured_fils` onto every row; `COUNT(DISTINCT id)` de-duplicates the count but nothing de-duplicates the SUM. `captured_fils` is a running total overwritten by each partial capture (`capture.ts:201`). Settlement batches instead sum the per-event delta `te.amount_fils` (`batch.go:144-147`). The docstring "joined through transaction_events for batch parity" and `docs/perf/2026-07-settlement-summary-slow.md:33-46` (which saw a ~38% gap for Delta Wholesale and dismissed it) hid it.

**What it breaks:** 30.000 BD captured as 12.000 + 10.000 + 8.000 BD on one Bahrain day: batch gross 30,000 fils, summary 3 × 30,000 = 90,000 fils (+200%). Across a month boundary, 10.000 BD on 30 Jun and 20.000 BD on 1 Jul shows 30.000 BD for each month, and June's figure changes after the fact.

**Why it needed a fix:** merchants and finance reconcile against this summary; it disagrees with the settlement batches it claims parity with.

**Fix:** `apps/api/src/settlement/query.ts:367`:
```diff
-       SELECT t.id, t.captured_fils
+       SELECT t.id, te.amount_fils AS captured_fils -- SUM-1: per-capture delta, not the running total (batch.go parity)
```
Commit: this commit. Lines: prod +1/-1, test +45/-0.

**Why this is the smallest correct fix:** one column in the CTE; the outer `SUM`/`COUNT(DISTINCT)` and the DTO stay unchanged, and the window filter on `te.occurred_at` now also scopes the amount. Why not `SUM(DISTINCT captured_fils)`: wrong when two transactions have equal totals and still uses the running total. Why not rewrite the CTE away (dossier variant): same result, more lines; SUM-2 handles the performance side.

**Proof:** `settlement/query.audit.test.ts` "summary counts each capture delta once for a multi-capture transaction": before `expected 30000, actual 90000`; after passes. Existing single-capture tests in `routes/settlement.test.ts` still pass (11/11 together).

**Regression risk:** single-capture transactions are unchanged (delta == total). Covered by `routes/settlement.test.ts` and the new test.

**Trap note:** the "for batch parity" docstring at `query.ts:357` is now true; the perf note's dismissal of the 38% gap remains in `docs/perf/` (not owned).
