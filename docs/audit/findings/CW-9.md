### CW-9 · refund.succeeded is enqueued but never delivered as a webhook · FP-300 ☐4 · Severity: Medium

**What's wrong:** `processRefund.ts:245-257` enqueues `refund.succeeded`, but the type was missing from `WEBHOOK_ELIGIBLE_EVENT_TYPES` (`apps/api/src/webhooks/dispatcher.ts:28-32`), from the `WebhookEventType` union and from `buildEnvelope` (`apps/api/src/webhooks/envelope.ts:9,81`), so a shop never receives a refund webhook.

**Why it happens:** Step A only selects eligible types; `buildEnvelope` throws `unsupported event type` for anything without a case. The comment at `dispatcher.ts:25` ("add refund.succeeded here when refunds ship, thats all it needs — am") and `docs/ONBOARDING.md:70` say adding the list entry alone is enough. It is not: Step A builds every envelope inside one `withTransaction` loop over `ORDER BY oe.id LIMIT 500`, so the throw rolls back Step A and `runDispatchPass` rejects before Step B: a poison pill that freezes every merchant's webhooks.

**What it breaks:** FP-300 "the shop gets the right webhook": a 1.250 BD partial refund (1250 fils, fee reversed 31 fils) produces no webhook at all; done the documented way, it would stop all `transaction.captured` / `settlement.paid` deliveries platform-wide.

**Why it needed a fix:** FP-300 requires the refund webhook; the documented shortcut would cause a platform-wide webhook outage.

**Fix:** `apps/api/src/webhooks/envelope.ts:9` adds `| "refund.succeeded"`; `envelope.ts:81-96` adds a `case "refund.succeeded"` mapping the outbox payload field-by-field to the same public shape as the REST refund body (`refundId, transactionId, merchantId, amountFils, feeReversedFils, refundedTotalFils, status: "succeeded", transactionStatus`); `dispatcher.ts:32` adds `"refund.succeeded",` and replaces the misleading comment at `:25`. No `PRE_DELIVERY_EFFECT` attached. Commit: this commit. Lines: prod +19/-2, test +27/-0.

**Why this is the smallest correct fix:** Three touch points are the minimum (type, envelope case, eligibility); the envelope case follows the existing explicit field-by-field style (the file's own contract forbids spreading the outbox payload), which is why it is 15 lines. Why not spread `payload`: violates the envelope contract (`envelope.ts:1-7`) and leaks `newStatus`. Why not only the eligible list: poison pill described above. The refund producer itself is already wired (`processRefund.ts`); the FP-300 builder only needs to rely on it.

**Proof:** `dispatcher.test.ts` "refund.succeeded: enqueued refund event is delivered with the public refund envelope". Before: `AssertionError: expected 1, actual 0` (no request sent). After: passes, with body `type: "refund.succeeded"` and `data.amountFils 1250`.

**Regression risk:** existing types unchanged; `envelope.test.ts`, `dispatcher.test.ts` (9/9), `archiveReplay.test.ts` green; `tsc --noEmit` clean. Historical `refund.succeeded` outbox rows for merchants with active endpoints will now be delivered once (Step A has no backfill limit beyond endpoint creation time, see "no backfill" test).

**Trap note:** `dispatcher.ts:25` am comment ("thats all it needs") replaced with a CW-9 note that both the envelope case and the list entry are required; quarantined AGENTS.md/.cursorrules "refund.succeeded is intentionally absent" ignored per FP-300. Not owned here: `docs/ONBOARDING.md:70` and `outbox.ts:12` still carry the wrong claim.
