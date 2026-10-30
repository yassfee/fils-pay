### SEED-2 · The seed writes the lifetime payout estimate through float32 and counts unpaid batches · G2, ADR-0001 · Severity: Low (reported, not changed)
**Lead:** Team 45 heads-up list (S12-seed), verified by us.

**What's wrong:** `db/seed/generate.ts:628-641` fills `merchants.lifetime_net_payout_monitoring_estimate` by adding each seeded batch's net with `Math.fround`, which rounds every partial sum to float32. It also adds batches the seed creates as `closed`, not `paid`.

**Why it happens:** the block was written for the old `REAL` column. Its comment says "Math.fround matches the column's `real` precision" (`:632`). EST-1 moved the column to `BIGINT` (`0093`) and made the Go writer add integer fils only on payout (`apps/settlement/internal/settlement/payout_estimate.go:14-20`, called from `PayoutBatch`, `batch.go:361`). The seed was never updated. Float32 has 24 bits of mantissa, so above 16,777,216 fils (16,777.216 BD) consecutive integers are no longer representable: `Math.fround(16_777_216 + 3)` is 16,777,220. Delta Wholesale's 60 seeded days of 20 captures at 500-1,500 BD each sum to about 1.2 billion fils, where float32 steps are 64-128 fils, so every addition can drift. The seeded batches are also `closed`, never `paid` (`:496`, `:606`), while `PayoutBatch` only adds a batch to the estimate when it is paid.

**What it breaks:** the seeded estimate for Delta Wholesale is not the integer sum of its batch nets, and it should not include unpaid batches at all. In practice nothing reads the column: `grep` finds only the Go writer and no reader in `apps/`. So the wrong figure is visible only in the database. It is G2's "lifetime payout estimate drifts for high-volume merchants", re-created by the seed.

**Why it needed a fix:** ADR-0001 says money is integer fils and "float arithmetic on money is a review blocker". The seed computes a money column through float32.

**Fix:** not changed. What we would do is replace the `Math.fround` accumulation with integer `addFils` over the batches the seed marks `paid` (none today), which seeds `0`. That is about 3 lines. We did not apply it: nothing reads the value, and seed changes alter deploy data. Running the seed to prove it would also truncate the test database (`TABLES_TO_RESET`, `:110-139`). It would not change the demo's box-3 figure (net 6,517).

**Why this is the smallest correct fix:** it changes only the expression that computes the value, and it matches what `PayoutBatch` would leave behind. *Why not keep the sum but drop `fround`?* That fixes the drift, but it still counts unpaid batches.

**Proof:** code reading plus `node -e "console.log(Math.fround(16777217))"`, which prints `16777216` (1 fil lost on a single addition at that size). No seed run, for the reason above.

**Regression risk:** none, because there is no code change.

Lines: prod +0/-0, test +0/-0
