### BAL-2 · Balance rebuild counts unbatched captures and refunds that the close then adds again · F4 · Severity: Medium

**Lead:** Team 45 heads-up list (S14/R5c-rebuild), verified by us, and our 03_findings BAL-2.

**What's wrong:** `merchant_balances.cached_payable_fils` is maintained incrementally: `CloseBatch` adds the batch net (`balances.ApplyBatchClose`), `PayoutBatch` subtracts it, and the admin credit/adjustment/import paths add their own legs. A capture or refund the API has journaled but no batch has closed yet has not reached the cache. The rebuild (`settlement rebuild-balances` and, since BAL-1, the admin "Recalculate cached balances" button) wrote the full `merchant_payable` ledger sum instead, which already contains those unbatched legs. When the batch then closes, `ApplyBatchClose` adds the same money a second time, and payout removes it only once.

**Why it happens:** `apps/settlement/internal/ledger/rebuild.go:22-26` (`RebuildMerchantBalance`) and `:101-106` (`RebuildAllBalances`) summed every `merchant_payable` leg. capture.ts and processRefund.ts post those legs at capture/refund time (`apps/api/src/payments/capture.ts:227-244`, `processRefund.ts:216-226`) and never touch the cache, while `CloseBatch` posts no `merchant_payable` legs but moves the cache by the batch net (`batch.go:284-285`). The two sides therefore measure different things between capture and close. The rebuild also read the cached value without a lock (`rebuild.go:89` TODO, "a concurrent CloseBatch increment gets clobbered -- YA").

**What it breaks:** Day 1: a 10,000 fils capture closes; cache 9,775 (fee 250 less a 25 fils discount). Day 2, before its close: a 20,000 fils capture (net 19,550) and a 1,000 fils refund with 25 fils fee reversal (net -975). An operator presses "Recalculate cached balances": the cache becomes 28,350. At day 2's close the cache rises to 46,925 and after both payouts it sits at 18,575 fils although the merchant is owed 0. This is the case-file F4 pattern (button, CLI and the incremental path disagreeing) and keeps the Rebuild → Adjust churn going. The test reproduces it: `cached_payable_fils rebuild right after close must not move the cache = 28350, want 9775`.

**Why it needed a fix:** F4: support and payouts read the cached balance, and the rebuild is the documented repair. A repair that adds a day of unbatched captures to the figure (then doubles them at close) makes the balance wrong precisely when someone tries to fix it.

**Fix:** `apps/settlement/internal/ledger/rebuild.go:24,26-28` and `:98,107,109-111`
```diff
-		  FROM ledger_entries
+		  FROM ledger_entries le
 		 WHERE merchant_id = $1 AND account_id = 'merchant_payable'
+		   AND NOT EXISTS (SELECT 1 FROM transaction_events te WHERE te.transaction_id = le.transaction_id AND te.settlement_batch_id IS NULL -- BAL-2 (F4): unbatched capture legs reach the cache at close, not before
+		         AND te.event_type IN ('captured', 'partially_captured') AND le.occurred_at IN (te.occurred_at, te.created_at))
+		   AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.transaction_id = le.transaction_id AND r.settlement_batch_id IS NULL AND le.occurred_at IN (r.occurred_at, r.created_at))
```
The same three lines go into `RebuildAllBalances`' sum, and its cache read becomes `... WHERE merchant_id = $1 FOR UPDATE`. A leg is left out only while the capture event or refund it was written with is still unbatched; it is matched exactly as FEES-5's `CloseBatch` matches a capture event to its fee legs (same transaction, `occurred_at` equal to the event's `occurred_at` or `created_at`), and a refund to its legs the same way (processRefund writes the refund row and its legs in one DB transaction). Everything else (batched captures and refunds, payouts, split payouts, MDR recalculation, admin credits, adjustments and imports) is summed as before, so the rebuilt figure equals what close-and-payout produce. Once everything is closed and paid it equals the full ledger sum, as before.

The `FOR UPDATE` closes the YA race for this rule: if a close holds the merchant's cache row, the rebuild waits and its next statement sees the close's events marked batched; if the rebuild holds it first, the close waits and adds its net on top of the rebuilt figure. Without it, a close committing between the sum and the upsert would be overwritten.

**Why this is the smallest correct fix:** one predicate pair in the two rebuild queries; no schema change, no change to capture, refund or close. *Why not make capture and refund move the cache (the lead's option b)?* That changes three money paths in two languages and every cache consumer's meaning (merchant dashboard balance, payouts) instead of the one place that disagrees. *Why not exclude every leg of a transaction with any unbatched event?* A transaction partially captured on two days would lose its batched day too. *Why not use `settlement_batches.net_payout_fils`?* RecalculateMDR rewrites batch totals and posts its own legs (`recalculate_mdr.go:109,189-194`), so summing both would double count.

**Proof:** `TestRebuild_CloseBatchThenRebuildLeavesCacheUnchanged` (`apps/settlement/internal/settlement/rebuild_cache_audit_test.go`): close day 1, then an unbatched capture and an unbatched refund, then `RebuildAllBalances` and `RebuildMerchantBalance`; then payout, close day 2, payout, rebuild. Before the fix: `cached_payable_fils rebuild right after close must not move the cache = 28350, want 9775`. After: 9,775 after the rebuild, 18,575 after day 2's close, 0 at the end. Full Go suite `go test -p 1 ./...` passes.

**Regression risk:** `TestRebuildBalances_ValidToken` (`internal/internalapi/server_test.go`) seeded a "closed" batch by hand without marking its capture event batched, which `CloseBatch` always does (`batch.go` step 11); the fixture now marks it (+5 test lines), and the expected 12,000 fils is unchanged. A merchant whose capture events were never batched (test-mode merchants, which the daily run skips) now rebuilds to the figure the incremental path holds, i.e. without those captures. The admin button, the CLI and `--merchant` (read path) all use the same rule. Residual: a merchant's very first close racing a rebuild (no cache row to lock yet) can still lose that close's net.

Lines: prod +9/-3 (6 SQL lines added, 3 modified; comments inline), test +77/-0 new file and +5/-0 fixture
