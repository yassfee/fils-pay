### OBX-POISON · A missing rollup row makes the parity check throw and wedges the reporting consumer · FP-300 ☐5 · Severity: High

**What's wrong:** In `applyBatchClosed`, when `transaction_events` shows captures for the merchant's Bahrain day but `merchant_daily_volume` has no row for that day, `rollup` is `undefined` and `rollup.captured_count` throws a `TypeError`.

**Why it happens:** `apps/reporting/src/consumer/applyEvent.ts:147` cast `rollupResult.rows[0] as { captured_count: number }` without a check. The throw rolls back the whole pass (`runConsumerPass.ts:42-69`, by design), the listener logs it, and the next NOTIFY/poll re-selects the same event, so the watermark never moves past it. The block's own comment (`:120-128`) presents the check as a harmless "warn early" checkpoint, and the docstring at `:72-77` promises a missing row is "never a thrown error that would poison the whole pass", which was true only for the batch row.

**What it breaks:** After a fresh seed (thousands of capture `transaction_events`, one captured outbox event per merchant, plus a `settlement.batch_closed` for 2026-08-31), or after a lost capture event, the first such batch_closed event freezes volumes and payout trends for every merchant; catch-up and rebuild die on the same event; refund events added for FP-300 queue behind it forever. Recovery is manual SQL.

**Why it needed a fix:** FP-300 ☐5 needs reports to update; one stale day must produce a warning, not a platform-wide reporting outage.

**Fix:** `apps/reporting/src/consumer/applyEvent.ts:147-148`:
```diff
-    const rollup = rollupResult.rows[0] as { captured_count: number };
+    // OBX-POISON: no rollup row means rollup=0 (warn); a TypeError here would wedge the consumer.
+    const rollup = (rollupResult.rows[0] as { captured_count: number } | undefined) ?? { captured_count: 0 };
```
Commit: this commit. Lines: prod +2/-1, test +36/-0.

**Why this is the smallest correct fix:** one expression at the single dereference; the existing warning text then reports `rollup=0 ground_truth=N`, exactly the lag the check exists to surface. Why not wrap the parity check in try/catch: hides real SQL errors. Why not drop the parity check: loses the stuck-consumer signal.

**Proof:** `applyEvent.test.ts` "applyBatchClosed with ground-truth captures but NO rollup row warns and does not throw": before `TypeError: Cannot read properties of undefined (reading 'captured_count')`; after passes (one warning `rollup=0 ground_truth=1`, payout-trend row written).

**Regression risk:** only the missing-row branch changes. Covered by `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` (12/12, `--test-concurrency=1`).

**Trap note:** the docstring promise at `:72-77` ("never a thrown error that would poison the whole pass") is now true for the rollup row as well; the new comment names the failure mode.
