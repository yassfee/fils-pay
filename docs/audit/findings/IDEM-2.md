### IDEM-2 · Authorize idempotency fingerprint is an unkeyed SHA-256 over the full PAN and CVV, stored at rest ·  · Severity: Medium

**What's wrong:** Every authorize, whether through `POST /v1/transactions` or a payment-link `/pay` (both call `authorizeTransaction`), persisted `idempotency_keys.request_hash = sha256(canonicalJson({ amountFils, card: { pan, expiryMonth, expiryYear, cvv }, reference }))`. That is an unsalted, unkeyed digest of the full card number and its CVV, kept indefinitely.

**Why it happens:** `apps/api/src/payments/authorize.ts:51-55` passed the whole `input.card` object to `hashRequest`, and `payments/idempotency.ts:65-66` is a plain `createHash("sha256")`. `claimIdempotencyKey` stores the digest in `idempotency_keys.request_hash` (`db/migrations/0019`).

**What it breaks:** Anyone who can read that table (a backup, a replica, a support SQL session) recovers the CVV in at most 1000 hashes. The amount and reference sit beside the hash, and the PAN, expiry and amount are often known to an insider. The audit test does exactly this and gets `123` back. A known BIN plus last4 leaves about 10^6 to 10^9 PAN candidates × 1000 CVVs, which a GPU searches in seconds to minutes. PCI DSS 3.2 forbids storing the card verification code after authorization in any form, and 3.5 requires a stored PAN to be unreadable (keyed hash or strong crypto), not a plain SHA-256.

**Why it needed a fix:** This is sensitive authentication data at rest on every authorize. It is harmless today only because the acquirer is a simulator (`acquirer/types.ts:12`). The first real card through this code would put the platform out of PCI compliance.

**Fix:** `apps/api/src/payments/authorize.ts:53-54`
```diff
   const requestHash = hashRequest({
     amountFils: input.amountFils,
-    card: input.card,
+    // IDEM-2 (PCI): an unkeyed hash over PAN+CVV is brute-forceable offline; fingerprint only non-secret card fields
+    card: { last4: String(input.card.pan).slice(-4), expiryMonth: input.card.expiryMonth, expiryYear: input.card.expiryYear },
     reference: input.reference ?? null,
   });
```

**Why this is the smallest correct fix:** This changes one expression at the only place that fingerprints card input. The payment-link path reaches it through `paymentLinks/pay.ts:94`. Last4 and expiry are the fields PCI allows in the clear, so the digest holds nothing secret to brute-force. *Why not an HMAC over the full card with a server key?* `authorizeTransaction` has no config or key today, so the fix would have to thread a new secret through two callers and add key management, which is far more than 10 lines. Reusing an existing key, such as the webhook encryption key, for an unrelated purpose would be key misuse. *Why not drop the card from the fingerprint entirely?* Then two different cards (different last4) under one idempotency key would replay silently instead of returning 422 `idempotency_key_reused`. Keeping last4 and expiry keeps that detection for any realistic mistake. The one case lost is a reuse that differs only in PAN middle digits or CVV under the same key. That case now replays the first response, which is the safe direction: no second charge.

**Proof:** `IDEM-2: the authorize idempotency fingerprint holds no CVV or full PAN` (`apps/api/src/routes/transactions.audit.test.ts`) authorizes through the API, reads `request_hash`, and tries all 1000 CVVs with `hashRequest`.
Before: `not ok 2 ... error: 'CVV 123 recovered from idempotency_keys.request_hash'`.
After: `ok 2`. `transactions.test.ts` passes 11/11 (including the authorize idempotency replay and conflict tests), `paymentLinks.test.ts` passes 12/12, and `payments/idempotency.test.ts` passes 8/8.

**Regression risk:** Low. Rows written before the fix carry the old digest, so a retry that straddles the deploy with a reused key gets a one-time 422 `idempotency_key_reused`. Clients already handle that response, and keys are per request. Existing rows still hold the old card digests, so ops should purge or expire them; that is a data cleanup, not a code change.

Lines: prod +2/-1, test +34/-0
