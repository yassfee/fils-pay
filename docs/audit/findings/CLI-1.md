### CLI-1 · `settlement rebuild-balances --merchant=<id>` prints the rebuilt figure but never writes it · F4 · Severity: Low

**Lead:** Team 45 heads-up list (S14/R5c-rebuild), verified by us, and our 03_findings CLI-1 (also REBUILD-2).
**Category:** Bug

**What's wrong:** The one-merchant form of the balance repair, which the runbook lists under "Recompute it" (`docs/RUNBOOK.md:51-56`), computes the ledger figure, prints `rebuilt=<n>` and exits. `merchant_balances` is never touched, so the drifted cache the operator meant to fix stays as it was.

**Why it happens:** `apps/settlement/cmd/settlement/main.go:148-159` calls `ledger.RebuildMerchantBalance` and prints its result (held in a variable named `before`). `RebuildMerchantBalance` (`apps/settlement/internal/ledger/rebuild.go:20-34`, before) was a single `SELECT SUM`; only `RebuildAllBalances` ever wrote the cache. The comment at `main.go:153` ("am: --merchant writes the cache for that one merchant, same as the full rebuild") claimed otherwise.

**What it breaks:** After the F4 incident (Alpha Retail's cached balance knocked from about 135,000 BD to 7,000 BD), an operator runs `rebuild-balances --merchant=<alpha>`, reads `rebuilt=135000000…` and closes the ticket, but the dashboard and payouts keep reading 7,000,000 fils. In the test: a cache of 999,999 fils over a ledger of 19,500 fils stays 999,999 after the rebuild.

**Why it needed a fix:** F4 names the CLI rebuild as the repair ("Yousif had to run the CLI rebuild to fix it"); its targeted form silently does nothing, which is worse than failing.

**Fix:** `apps/settlement/internal/ledger/rebuild.go:19,21-28,30,41-45`
```diff
-// ledger_entries. CLI-only; the incremental path is in internal/balances.
+// ledger_entries and writes it (CLI-1). CLI-only; the incremental path is in internal/balances.
 func RebuildMerchantBalance(ctx context.Context, db *pgxpool.Pool, merchantID uuid.UUID) (money.Fils, error) {
+	tx, err := db.Begin(ctx) // CLI-1: lock, recompute and write in one transaction, like RebuildAllBalances
+	if err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): begin: %w", merchantID, err)
+	}
+	defer tx.Rollback(ctx) //nolint:errcheck
+	if _, err := tx.Exec(ctx, `SELECT 1 FROM merchant_balances WHERE merchant_id = $1 FOR UPDATE`, merchantID); err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): lock: %w", merchantID, err)
+	}
 	var balance int64
-	err := db.QueryRow(ctx, `
+	err = tx.QueryRow(ctx, `
 ...
-	return money.Fils(balance), nil
+	if _, err := tx.Exec(ctx, `INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, $2, now())
+		ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = $2, updated_at = now()`, merchantID, balance); err != nil {
+		return 0, fmt.Errorf("ledger: RebuildMerchantBalance(%s): write: %w", merchantID, err)
+	}
+	return money.Fils(balance), tx.Commit(ctx)
```
The function the `--merchant` branch already calls now does what `RebuildAllBalances` does for each merchant: sum every `merchant_payable` leg in the ledger (the same query; YA's handover says the CLI "reads the ledger", HANDOVER.md:34-35) and upsert, after first locking the merchant's cache row. `main.go` is unchanged and its comment becomes true.

**Why this is the smallest correct fix:** the CLI's only one-merchant entry point is this function, and its only production caller is the `--merchant` branch (grep), so no other behaviour changes. *Why not upsert in `main.go` (the lead's 3-line version)?* The read and the write would be separate statements without a lock, so a close committing in between would be overwritten (the race YA's own TODO at `rebuild.go:101` records for the full rebuild), and `cmd/` has no tests. The fix does not depend on how the full rebuild treats unbatched legs: it writes exactly the figure the command already printed. *Why not call `RebuildAllBalances` for `--merchant`?* It rewrites every merchant, which is not what the flag means.

**Proof:** `TestRebuildMerchantBalance_PersistsTheRebuiltCache` (`apps/settlement/internal/ledger/rebuild_test.go`): ledger +20,000/-500, drifted cache 999,999. Before the fix: `persisted cached_payable_fils = 999999, want 19500 (--merchant must write, not only print)`. After: returns 19,500 and persists 19,500. The ledger, settlement and internalapi packages pass, including the existing `RebuildMerchantBalance` tests (the value returned is unchanged).

**Regression risk:** `--merchant` now writes, as the runbook and the code comment always said. A merchant with no cache row gets one. An unknown merchant id now fails on the `merchant_balances` foreign key instead of printing 0.

Lines: prod +15/-3 (rebuild.go; 1 doc line, 1 inline comment), test +23/-0
