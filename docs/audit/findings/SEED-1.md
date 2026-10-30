### SEED-1 · The seed settles and scheme-exports the sandbox (test-mode) merchant · G3 · Severity: Low (reported, not changed)
**Lead:** Team 45 heads-up list (G7), verified by us.

**What's wrong:** `db/seed/generate.ts` writes a `closed` settlement batch for yesterday, with `scheme_export_lines`, for every merchant that has captures. That includes Gamma Hospitality, which the fixture marks `testMode: true`. The seed's own comment for it says "this merchant's activity must stay out of real settlement runs until they go live" (`db/seed/fixtures/merchants.ts:112-114`).

**Why it happens:** the per-merchant settlement block (`db/seed/generate.ts:566-625`) skips only marketplace fixtures and merchants with no transactions (`:572`, `if (fixture.marketplaceBusinessDays !== undefined || transactions.length === 0) continue;`). It never checks `fixture.testMode`. Real settlement does: `RunDailyBatch` and `CloseBatch` only close merchants with `test_mode = false` (`apps/settlement/internal/settlement/batch.go:121`, `:417`).

**What it breaks:** on a freshly seeded database (local or Dilmune), the admin settlement views and the merchant's batch pages show a closed batch for the sandbox merchant. About 34 transactions' scheme lines are listed as exported, for activity the scheme never received. A demo of G3 ("test merchants keep showing up in the real settlement run") shows the symptom from the seed itself, not from the code, which already excludes them.

**Why it needed a fix:** the seed contradicts its own fixture contract (`merchants.ts:112-114`) and the wired settlement code. For a test-mode merchant, settlement leaves nothing. Seed data is an unverified claim; the wired code is the reference.

**Fix:** not changed. The one-line fix is `|| fixture.testMode === true` on the `continue` condition at `generate.ts:572`. We did not apply it because seed changes alter deploy and demo data, and running the seed truncates the database (`TABLES_TO_RESET`, `:110-139`), so we could not prove it on the test DB without wiping the rows other suites rely on. It would not change the demo's box-3 figure (net 6,517 comes from `ops/demo.sh`'s own capture), but the seed summary counts (`settlementBatchCount`, `schemeExportLineCount`) and any test that pins them would change.

**Why this is the smallest correct fix:** one predicate at the single place that decides which merchants get a pre-baked batch, using the same rule as settlement. *Why not filter in settlement?* Settlement already filters, so the defect is only in the seed.

**Proof:** code reading. The `continue` at `generate.ts:572` is the only exit before the closed-batch INSERT (`:602-607`), and the Gamma fixture gets `TRANSACTIONS_PER_MERCHANT` transactions (`:309`, because it has no `splitParentKey`). So `transactions.length > 0`, and Gamma reaches the INSERT. No runtime proof, for the reason given above.

**Regression risk:** none, because there is no code change.

Lines: prod +0/-0, test +0/-0
