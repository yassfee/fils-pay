### OBX-DOUBLE · Unlocked cursor read lets concurrent reporting passes double-apply events · FP-300 ☐5 · Severity: High

**What's wrong:** `readCursor` seeds the cursor with `INSERT … ON CONFLICT DO NOTHING` and then a plain `SELECT`; neither locks the row, so two concurrent passes read the same watermark and both apply the same (non-idempotent, `+1`) events.

**Why it happens:** `apps/reporting/src/consumer/cursor.ts:32` is a snapshot read; `ON CONFLICT DO NOTHING` takes no lock on an existing row. Pass B reads watermark N while pass A is mid-batch, selects the same events, increments `merchant_daily_volume` again, and both commit the absolute `SET last_processed_id`. The `running` flag only serialises passes inside one process. Hidden by the am comment at `cursor.ts:23` ("nvm the `running` flag in listener.ts guards it") and YA at `:40` ("only one writer"); the RUNBOOK tells operators to run catch-up beside the live worker, and `catchUp.ts:18` records "rollup looked high after" on 2026-09-14.

**What it breaks:** catch-up next to the worker with 500 pending captures worth 1,000.000 BD (1,000,000 fils) leaves those merchants' daily volume at 2,000.000 BD with doubled counts, permanently; same for two containers overlapping in a deploy, or rebuild with the worker up.

**Why it needed a fix:** FP-300 ☐5 reports must be exact; doubled volumes are silently wrong and never self-correct.

**Fix:** `apps/reporting/src/consumer/cursor.ts:32`: append `FOR UPDATE` to the cursor SELECT (comment at `:23-24` replaced). A second pass blocks until the first commits and, under READ COMMITTED, re-reads the advanced watermark. `apps/reporting/src/cli/rebuild.ts:53`: `resetCursor` moved before the two `TRUNCATE`s so rebuild takes the cursor lock first, the same order as a pass (otherwise rebuild's ACCESS EXCLUSIVE on the rollup tables + a pass's cursor lock can deadlock). Commit: this commit. Lines: prod +4/-3, test +34/-0.

**Why this is the smallest correct fix:** the cursor row is the single serialisation point every pass already touches, in the same transaction. Why not `pg_advisory_xact_lock`: same effect, extra query and a magic key. Why not per-event dedupe table: new table + writes for every event.

**Proof:** `runConsumerPass.test.ts` "runConsumerPass: a pass overlapping another in-flight pass does not re-apply the same events" (pass A holds `readCursor` in an open transaction while `runConsumerPass` B starts): without the fix `expected 1, actual 2`; with it passes.

**Regression risk:** passes now wait for each other (they are short, one batch). Covered by `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` (13/13 with `--test-concurrency=1`, the package's own setting; these files share global tables, so running them in parallel interferes by design, e.g. rebuild TRUNCATEs mid-test).

**Trap note:** the am/YA comments at `cursor.ts:23,40` claimed a single writer; `:23` is replaced with the real reason for the lock. Not owned: `docs/RUNBOOK.md:63-78` (catch-up beside the worker) is now safe but should say so.
