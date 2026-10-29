### BAL-1 · Admin "rebuild cached balances" rebuilds from scheme export lines, not the ledger · F4, FP-203 · Severity: High
**What's wrong:** the admin console's rebuild button (`POST /internal/rebuild-balances`) overwrote every merchant's `merchant_balances.cached_payable_fils` with the sum of `scheme_export_lines` (the `merchant_payable_position` view), while the CLI `settlement rebuild-balances` walks `ledger_entries`. The two disagree, and the button's figure is not a balance.

**Why it happens:** `apps/settlement/internal/internalapi/server.go:268` called `ledger.RefreshBalanceCache`, whose query (`internal/ledger/refresh.go:26,62`) reads `merchant_payable_position` (migration 0054: SUM of export lines). The CLI (`cmd/settlement/main.go:162`) calls `ledger.RebuildAllBalances` (`rebuild.go:100-105`: SUM of merchant_payable credits − debits). Export lines are gross, never net of fee, never reduced by payouts, and omit every unbatched capture, credit, adjustment or refund. Hidden by `refresh.go:15-16` ("from the settled position"), by ADR-0004 (MK-only, untrusted: "It reflects what actually left the..."), and by `TestRebuildBalances_ValidToken`, which pinned the export total ("FH: 12000 = export total = what support sees in the console, so the test is right") with an export line equal to the ledger balance, so it could not tell the two apart.

**What it breaks:** Alpha Retail: CLI ≈ 135,000 BD (135,000,000 fils), button ≈ 7,000 BD (7,000,000 fils). A 100.000 BD capture at 2.5%, closed and paid, has a ledger balance of 0 fils, but the button writes 100,000 fils. It also wipes the cache deltas from Recalculate MDR, credits and imports (FP-203: support "re-adjusted" balances by hand on 15 Sept).

**Why it needed a fix:** support and payouts read the cached balance. One click silently rewrites every merchant to a wrong figure, and the case file (F4) says the CLI's ledger walk is the source of truth.

**Fix:** `server.go:268`
```diff
-		diffs, err := ledger.RefreshBalanceCache(r.Context(), pool)
+		diffs, err := ledger.RebuildAllBalances(r.Context(), pool) // BAL-1 (F4): same ledger walk as the CLI
```
`refresh.go:15-16` doc comment corrected to say it reads scheme_export_lines, not the ledger.
Commit: this commit. Lines: prod +3/-3 (1 code line, 2 comment lines), test +5/-5.

**Why this is the smallest correct fix:** one call site switches to the function the CLI already uses. It has the same signature and return type (`map[uuid.UUID]RebuildDiff`), so the response shape and the TS client are unchanged. Why not rewrite the 0054 view to read the ledger: it would change every other reader of the view, and it is a migration plus SQL. Why not delete refresh.go and refresh_test.go: they are now unreferenced, and deleting them is about 150 lines of churn with no behaviour change, so they are left for a cleanup PR, with the comment corrected so nobody rewires them.

**Proof:** `TestRebuildBalances_ValidToken` (internalapi/server_test.go), corrected per F4 (export line 11,990 vs ledger 12,000), failed before: `after = 11990, want 12000 (the ledger merchant_payable balance, F4)` and `persisted cached_payable_fils = 11990, want 12000`. It passes after; the internalapi and ledger packages are green.

**Regression risk:** the endpoint now does the CLI's per-merchant ledger walk in one transaction (already used in prod by the CLI; on a timeout the context cancels and the txn rolls back). `refresh_test.go` still tests `RefreshBalanceCache` in isolation; it no longer pins any product behaviour.

**Trap note:** ADR-0004 (MK-only; not in the trusted list) "accepts" the export-line source; it contradicts the case file F4 and was not followed. The "FH: ... so the test is right" comment and the "scheme-export-derived total" assertion message were corrected to cite F4.
