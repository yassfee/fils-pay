### TEST-OUTBOX-FIXTURE · Webhook archive test seeds malformed rollup events that break the reporting consumer tests · baseline test failure (FP-300 ☐5) · Severity: Low

**What's wrong:** 4 `apps/reporting` tests (`runRebuild`, `runConsumerPass` end-to-end ×2, atomicity) failed with `null value in column "merchant_id" of relation "merchant_daily_volume"`. The reporting code is right; the input was invalid test data.

**Why it happens:** `apps/api/src/webhooks/archiveReplay.test.ts:62-64` inserted `outbox_events` rows with a real, rollup-eligible `event_type` (`transaction.captured` / `transaction.voided`) and payload `'{}'`. The reporting consumer's watermark is global (`runConsumerPass.ts:46-53`), so once the api suite has run against the same database, the next reporting pass applies those rows and `applyTransactionCaptured` inserts `merchant_id = NULL`. Production producers (`capture.ts`, `void.ts`) always send `merchantId`. `admin.test.ts:912-916` already documents and avoids exactly this ("a deliberately inert event_type").

**What it breaks:** CI only: a red reporting suite whenever suites share a DB (the normal `npm test` order).

**Why it needed a fix:** The failures hid real reporting regressions behind a known-red baseline.

**Fix:** `apps/api/src/webhooks/archiveReplay.test.ts:62-66`: the outbox row uses the inert type `'archive.test.replay_fixture'` (archive replay reads `event_type` from `webhook_deliveries`, which keeps the real type). Local test DB: the 21 already-inserted rows were re-typed the same way (`UPDATE … WHERE payload = '{}'`, test DB only). Commit: this commit. Lines: prod +0/-0, test +4/-2.

**Why this is the smallest correct fix:** fix the fixture that produces invalid events, not the consumer. Why not make the consumer skip events without `merchantId`: it would silently drop data for a malformed real event; the poison-pill class is handled for the real case in OBX-POISON.

**Proof:** before: `runConsumerPass … end-to-end …` → `null value in column "merchant_id"`; after: `applyEvent.test.ts`, `runConsumerPass.test.ts`, `cli/rebuild.test.ts` 11/11 pass with `--test-concurrency=1` (the package's own `npm test` setting); `archiveReplay.test.ts` 4/4.

**Regression risk:** none (test-only). Note: running the reporting files in parallel (without `--test-concurrency=1`) still flakes, because two concurrent passes double-apply (that is OBX-DOUBLE, fixed separately).

**Trap note:** the failure looked like a reporting NOT NULL bug; the cause was a cross-suite fixture.
