### CW-3 · Outbound webhook signature does not cover the bytes actually sent · FP-240, FP-300 ☐4 · Severity: High

**What's wrong:** The dispatcher and test-send sign `${t}.${canonicalJson(payload)}` (keys sorted) but post `JSON.stringify(payload)` (JSONB key order), so a receiver verifying HMAC(t + "." + rawBody), the normal `t=,v1=` practice, always gets a mismatch.

**Why it happens:** `apps/api/src/webhooks/sign.ts:36` signs `canonicalJson(payload)`; `apps/api/src/webhooks/dispatcher.ts:172` sent `JSON.stringify(row.payload)`, where `row.payload` comes back from the JSONB column `webhook_deliveries.payload` (0022) with keys reordered shortest-first; `apps/api/src/webhooks/testSend.ts:62` did the same with a literal `{id,type,createdAt,data}`. Faulty assumption: "the payload is the same object, so the bytes are the same". Hidden by `dispatcher.test.ts:171` and `testSend.test.ts:106`, which `JSON.parse` the body and re-canonicalize before verifying (FH comments `dispatcher.test.ts:131` "signing is proven correct", `testSend.ts:31` "signs exactly the bytes it sends").

**What it breaks:** A `transaction.captured` delivery is sent as `{"id":…,"data":{"status":"captured","feeFils":71,…},"type":…,"createdAt":…}` but the MAC covers `{"createdAt":…,"data":{"amountCapturedFils":4750,…},"id":…,"type":…}`. A raw-body verifier answers 401, the row is retried `webhookMaxAttempts` times and exhausted; merchants either drop verification (accepting forged webhooks) or re-serialize like V8 does.

**Why it needed a fix:** FP-240/FP-300 require the shop to receive a webhook it can verify; today every delivery to a correctly written receiver fails.

**Fix:** `apps/api/src/webhooks/dispatcher.ts:7,173` and `apps/api/src/webhooks/testSend.ts:5,63`:
```diff
+import { canonicalJson } from "../payments/idempotency.js";
-    body: JSON.stringify(row.payload),
+    body: canonicalJson(row.payload), // CW-3: the exact string signPayload signed (FP-240)
-    body: JSON.stringify(testPayload),
+    body: canonicalJson(testPayload), // CW-3: the exact string signPayload signed (FP-240)
```
Commit: this commit. Lines: prod +4/-2, test +9/-2.

**Why this is the smallest correct fix:** The sent body is the single point that diverges; `canonicalJson` is the exact serializer `signPayload` already uses, so signed string == sent string. It is also deterministic over the stored JSONB row, so a disputed delivery can be byte-reproduced from `webhook_deliveries.payload`. Why not a new `signBody(body)` helper in sign.ts plus a `verifySignature(rawBody)` signature change: more lines, new API, and changes every verifier call site (incl. routes tests we do not own). Why not change `signPayload` to `JSON.stringify`: the JSONB round-trip order would then differ between first attempt and replays.

**Proof:** `dispatcher.test.ts` "one active endpoint, 2xx response: … signature verifies with the raw secret" and `testSend.test.ts` "the signature this call site produces verifies against the endpoint's own raw secret" now also check `createHmac(secret).update(`${t}.${req.body}`) === v1`. Before: `AssertionError: signature must cover the exact bytes sent` (expected `17a3abbf…`, actual `3f315774…`). After: both pass.

**Regression risk:** Body is still valid JSON with the same keys/values, so receivers that `JSON.parse` are unaffected; `verifySignature` (parse + canonicalize) still passes. Covered by `dispatcher.test.ts`, `testSend.test.ts`, `sign.test.ts`, `archiveReplay.test.ts` (all green except the pre-existing jitter assertion, fixed separately).

**Trap note:** The FH comment at `dispatcher.test.ts:131` ("signing is proven correct") is now followed by a CW-3 correction line, and the test asserts on the raw bytes; `testSend.ts:31` ("signs exactly the bytes it sends") is now true. Not owned here and still to correct: `outbox.ts:92` MK note and `docs/RUNBOOK.md:95-97` (re-serialize workaround), and `routes/webhooks.test.ts:307,:519` still verify via `JSON.parse`.
