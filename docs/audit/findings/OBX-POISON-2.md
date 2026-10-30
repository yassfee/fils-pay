### OBX-POISON-2 · One malformed reporting event stops all reporting until someone intervenes (hardening) · Severity: Low (reported, not changed)
**Category:** Reported, not changed

**What's wrong:** The reporting consumer applies outbox events in batches inside one transaction (`apps/reporting/src/consumer/runConsumerPass.ts`). If one event of a handled type (`transaction.captured`, `transaction.voided`, `settlement.batch_closed`, `refund.succeeded`) has a malformed payload, for example no `merchantId`, its rollup write fails (`null value in column "merchant_id" of relation "merchant_daily_volume"`). The whole pass then rolls back and the watermark stays put. Every later pass re-selects the same event and fails again, so the reporting rollups stop advancing until someone removes or repairs that event.

**Why it happens:** The design is deliberately fail-loud: `applyEvent.ts:184-191` says a thrown error "rolls back the whole pass … rather than silently dropping the event", and the test "runConsumerPass: atomicity — an apply failure partway through a multi-event batch rolls back the WHOLE pass" pins that behaviour. There is no dead-letter path for a single bad event.

**What it breaks:** Today, nothing in production: the consumer selects only the four handled types (`event_type = ANY(REPORTING_EVENT_TYPES)`), and every production producer of those types writes `merchantId`: `payments/capture.ts`, `payments/void.ts`, `payments/processRefund.ts` and the Go `settlement.batch_closed` producer. We saw the stall only on a reused test database, where a test-only row of a handled type without `merchantId` sat after the cursor: 5 of 6 consumer tests failed. A fresh database in the normal order (api suite, then reporting) passes 17/17. If a future producer bug or a manual SQL insert wrote such a row on the live box, reports would freeze and nothing would be lost: the ledger and the settlement figures are unaffected, and the rollups can be rebuilt (RBD-1).

**Why it needed a fix:** It is hardening, not a case-file defect. The case file needs the reports to be right. A stalled consumer is detectable, because reports go stale, and recoverable, so this is left open.

**Fix:** Not changed. What we would do: move an event that fails to apply to a dead-letter table (with the error) in its own savepoint, advance past it, and alert, while keeping the batch atomic for all other events. That changes the pinned atomicity contract and needs about 25 lines plus a migration. It is not worth that risk two hours before the freeze.

**Why this is the smallest correct fix:** No code change. Recording the risk and the recovery path (find the event with `SELECT id, event_type FROM outbox_events WHERE event_type = ANY(...) AND payload->>'merchantId' IS NULL`, then rebuild with RBD-1) is the correct action at this point.

**Proof:** Reused test DB: `runConsumerPass.test.ts` 1 pass / 5 fail with the not-null error above. Fresh DB in suite order: api 454/454, then reporting 17/17, web 9/9 (e600d94).

**Regression risk:** None (no code change).

Lines: prod +0/-0, test +0/-0.
