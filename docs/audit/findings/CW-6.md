### CW-6 · Webhook replays mint a new Webhook-Delivery-Id, so receivers cannot dedupe them · INC-2026-08-21 · Severity: Medium

**What's wrong:** each replay (the merchant single-delivery replay, the admin replay-batch and the archive restore) wrote a new random `delivery_event_id` and overwrote the envelope's body `id` with it. A receiver that dedupes on `Webhook-Delivery-Id` or on the body `id`, as the platform tells it to, sees the replay as a brand-new event. A replayed `settlement.paid` therefore shows up as a second "your payout is on the way" (INC-2026-08-21), and a replayed `refund.succeeded` looks like a second refund.

**Why it happens:** `apps/api/src/webhooks/replay.ts:48-49` ran `randomUUID()` and built `{ ...original.payload, id: newDeliveryEventId }`. All three replay paths go through this one function. The faulty assumption was that a replay is "legitimately a new delivery" for dedupe (docstring `:24-34`, and the MK comment `:46`: "receivers dedupe on the original id in the body", but the same line overwrote that body id). The trusted contract says the opposite: `headers.ts:12` (YA) "must be stable across retries AND replays (ARCH §5)", `envelope.ts:12` "the dedup key", `0022:43-44` "replay must reuse delivery_event_id". `routes/webhooks.test.ts:348-413` locked the bug in with `assert.notEqual(replayRow.delivery_event_id, original.delivery_event_id)`, under a YA-attributed comment that contradicts YA's own line in `headers.ts`.

**What it breaks:** a merchant (or an admin running replay-batch over a period) replays a succeeded `settlement.paid`. The receiver gets the same event with a new id, cannot detect the duplicate, and notifies the shop a second time.

**Why it needed a fix:** a stable delivery id is the platform's only promise that lets receivers process each event once. Every replay breaks that promise.

**Fix:** `apps/api/src/webhooks/replay.ts:1,24-34,46-49,60`
```diff
-import { randomUUID } from "node:crypto";
...
-  const newDeliveryEventId = randomUUID();
-  const replayPayload = { ...original.payload, id: newDeliveryEventId };
+  // CW-6: reuse the original id (the envelope id is the delivery_event_id) so receivers can dedupe
+  const deliveryEventId = String(original.payload.id);
+  const replayPayload = original.payload;
...
-      newDeliveryEventId,
+      deliveryEventId,
```
The docstring that justified new ids (11 lines) is rewritten to the ARCH §5 contract (5 lines), and the MK/FH comment pair is replaced by one line.
Lines: prod +9/-17 (code +3/-4: 3 changed lines plus the now-unused import; comments +6/-13), test +7/-6 (a wrong assertion corrected).

**Why this is the smallest correct fix:** the single shared function fixes all three replay paths. The envelope `id` already equals the original `delivery_event_id` (`envelope.ts:12`, set at fan-out), so no lookup or interface change is needed. `delivery_event_id` has no unique constraint (`0022`), and the replay row is still a new row with `replay_of_delivery_id`, so attempt history is kept. The signature stays fresh because the dispatcher signs at send time (`dispatcher.ts:160`). *Why not add `delivery_event_id` to `OriginalDelivery`?* That touches three callers and their SELECTs for the same value. *Why not dedupe on the server?* The receiver contract is the stable id, and a replay must still be deliverable to a receiver that lost the event.

**Proof:** the corrected test `replay: creates a new row referencing the original, with the SAME delivery_event_id; original row untouched` (`apps/api/src/routes/webhooks.test.ts`) failed before the fix: `assert.equal(replayRow.delivery_event_id, original.delivery_event_id)` got `actual: 'dada1f34-...'`, `expected: 'fd275a43-...'`. After the fix it passes, and it also checks the received `webhook-delivery-id` header and the body `id`. The correction is backed by the case file INC-2026-08-21 (duplicate payout notifications) and by ARCH §5 as quoted in `headers.ts`.

**Not fixed here (file outside this lane): role gate.** `routes/adminMerchants.ts:213,258,299` (replay-batch, archive, archive replay) use only `requireAdminSession` (any role, including `support`), and `:233` accepts any `statuses` list, including `succeeded`. The single-line fix per route is `[requireAdminSession, requireAdminRole("finance", "super_admin")]`, the same as `:135,178`. With stable ids, a replay of a succeeded delivery is now deduped by receivers, and the disbursement side effect is already capped per batch by CW-1 (`0087_settlement_payout_disbursements_unique_batch.sql`), so what remains is the H3 role question. It is left to the owner of `adminMerchants.ts`.

**Regression risk:** receivers that relied on new ids to "force" a re-process will now dedupe replays, which is the documented contract. `routes/webhooks.test.ts`, `webhooks/archiveReplay.test.ts`, `webhooks/dispatcher.test.ts` and `routes/admin.test.ts` pass (64/64).

**Trap note:** the docstring gives a plausible reason for the bug ("would make a receiver silently swallow the replay"), and the test comment attributes "new id is what ARCH §5 asks for" to YA, whose actual line in `headers.ts` says the opposite.
