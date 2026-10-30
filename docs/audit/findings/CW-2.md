### CW-2 · Acquirer callbacks accepted without a signature by default · FP-240 · Severity: Medium
**Category:** Bug

**What's wrong:** `POST /v1/acquirer/callbacks` is public and the HMAC header is its only authentication, yet `verifyAcquirerCallbackSignature` returned `{ valid: true }` when the header was missing unless `requireSignature` was set, and `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` defaulted to `false`.

**Why it happens:** `apps/api/src/webhooks/inboundVerify.ts:50` `requireSignature = false` and `:52-56` turned a missing header into `{ valid: true }`; `apps/api/src/config.ts:259` `parseBoolEnv(env.ACQUIRER_CALLBACK_REQUIRE_SIGNATURE, false)`, and nothing in compose/env sets it. An empty secret (allowed outside production, `config.ts:193`) also yields an HMAC anyone can compute. Hidden by `app.ts:71` FH ("inboundVerify rejects unsigned requests, so OK"), `config.ts:119` ("Set true once the sandbox signs everything"), `routes/acquirerCallbacks.test.ts:122-139` (asserted 200 for an unsigned callback as "dev-mode behaviour … prod rejects — MK"; prod did not reject) and `inboundVerify.test.ts:49-53`.

**What it breaks:** Anyone who knows a transaction UUID (the cardholder gets it from the pay response) can POST `{callbackId, type:"fraud_review.completed", transactionId, outcome:"cleared", note:"Manual review cleared"}` with no header and get `200 {received:true}`: a forged fraud verdict stored, in the acquirer's name, against a real merchant's payment. What the verdict can do is limited. `applyAcquirerCallback` (`apps/api/src/acquirer/callbacks.ts:27-52`) runs one SELECT for the merchant and one INSERT into `acquirer_callback_notes`. It never touches `transactions.status` or the ledger, and no application code reads the notes back (grep over `apps/`; the docblock's "surfaced on the transaction timeline" is not wired). The harm is a false record for whoever reviews fraud verdicts, not a money movement.

**Why it needed a fix:** FP-240 ("someone said the incoming signature check has its own problems"). The signature is this public endpoint's only authentication, so without it anyone can write fraud verdicts in the acquirer's name. Severity is Medium, not High, because the verdicts are informational notes only (see above).

**Fix:** `apps/api/src/webhooks/inboundVerify.ts:45-51`:
```diff
-/** Verifies the acquirer callback signature when present and required. */
+/** Verifies the acquirer callback signature; a missing header or empty secret is rejected (CW-2, FP-240). */
 ...
   secret: string,
-  requireSignature = false,
 ): VerifyAcquirerCallbackResult {
-  if (!header) {
-    return requireSignature
-      ? { valid: false, reason: "malformed_header" }
-      : { valid: true };
-  }
+  if (!header || !secret) return { valid: false, reason: "malformed_header" };
```
plus removal of the now-dead flag: `routes/acquirerCallbacks.ts:61` (argument), `config.ts:119-120,259` (field, its misleading comment, parse). Commit: this commit. Lines: prod +2/-11, test +9/-12.

**Why this is the smallest correct fix:** The verifier is the single place the decision is made. Why not only flip the default to `true` (`config.ts:259`): one env var could silently re-open the hole, and an empty dev secret would still verify forged HMACs. Why keep the flag but ignore it: a dead knob documented as a switch is a new trap. Rotating the committed secret (`ops/.env.docker`) is an ops action outside this lane (see B8 commit).

**Proof:** `routes/acquirerCallbacks.test.ts` "POST /v1/acquirer/callbacks rejects a callback sent without a signature header": before `expected 401, actual 200`; after passes (401 `invalid_signature`, 0 notes stored). `inboundVerify.test.ts` "an unsigned callback, or an empty secret, is rejected (malformed_header)": before `{valid:true}`; after passes.

**Regression risk:** Any unsigned caller is now rejected; no in-repo sender posts callbacks (grep). Covered by `inboundVerify.test.ts`, `routes/acquirerCallbacks.test.ts`, `acquirer/callbacks.test.ts` (14/14), `tsc --noEmit` clean.

**Trap note:** The two tests that asserted acceptance were rewritten to assert rejection, citing CW-2/FP-240; the `config.ts:119` comment was removed with the flag. Not owned here: `app.ts:71` FH comment is now true but should cite CW-2; `docs/ARCHITECTURE.md:91` and CHANGELOG still document the flag.
