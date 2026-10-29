### EST-1 · Lifetime payout total is a REAL accumulated through float32 · G2 · Severity: Medium
**What's wrong:** `merchants.lifetime_net_payout_monitoring_estimate` is a `REAL` column, and every `PayoutBatch` adds `float32(netPayoutFils)` to it. A money total is therefore stored with about 7 significant digits and drifts once it passes 2^24 fils (16,777.216 BD).

**Why it happens:** `apps/settlement/internal/settlement/payout_estimate.go:19` (`float32(netPayoutFils)`) and migration `0040` (`REAL NOT NULL DEFAULT 0`). The faulty assumption is "monitoring only, nothing reads it back" (0040 comment, "MK: nothing reads this back. don't spend time on it"), which contradicts the case file and ADR-0001 (money is integer fils). The test comment "FH: float32 exact up to 2^24 so small values are fine; big ones drift but nobody reads it" (payout_estimate_test.go:13), and the test's small-only amounts, hid it.

**What it breaks:** two payouts of 22,219,551 + 9,334,173 fils should total 31,553,724 fils; the REAL column holds 31,553,700 (24 fils lost on just two batches). The drift grows with every batch. Ops compares this figure with batch history to flag anomalous payouts, so a false anomaly (or a masked real one) follows. The seed (generate.ts:628-641) replays the same float32 drift.

**Why it needed a fix:** it is a fils figure shown to ops as a payout total. The case file allows no floats in money, and the error is unbounded over a merchant's lifetime.

**Fix:** `payout_estimate.go:19` + new `db/migrations/0093_lifetime_payout_estimate_bigint.sql`
```diff
-	`, merchantID, float32(netPayoutFils))
+	`, merchantID, int64(netPayoutFils)) // EST-1 (G2): integer fils, column is BIGINT (0093)
```
```sql
ALTER TABLE merchants ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;
```
Commit: this commit. Lines: prod +1/-1 Go and +5 SQL (2 comment lines), test +35/-1.

**Why this is the smallest correct fix:** one Go argument and one column type. The function signature is unchanged, and the column name stays (no reader rename). Why not float64/DOUBLE: still a float in money code, and it only postpones the drift (2^53). Why not drop the column: the ops dashboard and the seed use it. Not done here: backfilling the already-drifted values. `SUM(net_payout_fils)` over paid batches would differ, because split payouts never bumped this counter, so that needs an ops decision. `EstimateMonthlyPayout` (same file) also sums in float32, but it has no production caller and changing its return type would change its signature; flagged for follow-up.

**Proof:** `TestUpdateLifetimePayoutMonitoringEstimate_LargeValuesExact` (payout_estimate_audit_test.go) failed before: `lifetime estimate = 31553700, want exactly 31553724 (22219551 + 9334173)`. It passes after migration 0093. The existing `TestUpdateLifetimePayoutMonitoringEstimate_SmallValuesExact` and the PayoutBatch tests still pass.

**Regression risk:** node-pg returns BIGINT as a string, but no TS code reads this column. The seed writes integer-valued `Math.fround` numbers, which BIGINT accepts. Migration 0049's mention is a comment only.

**Trap note:** the FH test comment (`payout_estimate_test.go:13`) is replaced to point at the new test. The 0040 "nothing reads this back" note stays (old migrations are immutable) and is superseded by 0093.
