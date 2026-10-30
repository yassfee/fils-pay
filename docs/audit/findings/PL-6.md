### PL-6 · Public payment-link read leaks the merchant's live API key prefix and SHA-256 hash ·  · Severity: Medium

**What's wrong:** `GET /v1/payment-links/:token` is public and unauthenticated. It returned `merchantPublicKey`, the first 16 characters of the merchant's newest unrevoked secret API key, and `merchantIntegrationId`, that key's `key_hash` (the exact SHA-256 verifier that API-key authentication looks up). Anyone who holds a link token could read both.

**Why it happens:** `apps/api/src/paymentLinks/read.ts:40-53` (before the fix) joined `api_keys` through a `LEFT JOIN LATERAL` and selected `ak.key_prefix AS merchant_public_key, ak.key_hash AS integration_id`. Lines 73-74 then copied both into the response. The "public key" name is misleading: `apiKeys/issue.ts` builds the raw secret as `fp_<env>_` plus 32 base64url characters and stores `keyPrefix = rawKey.slice(0, 16)`, so the prefix is part of the secret itself. The doc comment at `read.ts:18` ("Contains nothing that identifies or authenticates the merchant") was false. The hosted checkout's contract (`apps/web/src/types.ts:9-19`) says "The server must never add API-key fields to this response" and uses neither field.

**What it breaks:** A buyer opens a payment link and sees `"merchantPublicKey":"fp_live_AbC12xYz"` and `"merchantIntegrationId":"<64-hex sha256 of the live secret key>"`. That discloses 48 of the 192 random bits of the merchant's live secret, plus the stored verifier. It also gives an oracle for whether the merchant has a live key and when it rotates, since the values change on rotation. The same data reaches anyone who forwards, logs or screenshots the link. The rest of the codebase withholds `api_keys.key_hash` on purpose (`admin/merchants.ts:216`), and even admins never see it.

**Why it needed a fix:** This is a credential-material leak on an unauthenticated endpoint. Secret-key material and its verifier must never reach a public surface, and the client contract forbids it.

**Fix:** `apps/api/src/paymentLinks/read.ts:13-14, 26-27, 42-53, 73-74`: the two key fields come out of the row type, the DTO, the SELECT (the LATERAL join is gone) and the response.
```diff
-            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name,
-            ak.key_prefix AS merchant_public_key,
-            ak.key_hash AS integration_id
+            pl.status, pl.expires_at, pl.reserved_at, m.display_name AS merchant_display_name
        FROM payment_links pl
        JOIN merchants m ON m.id = pl.merchant_id
-       LEFT JOIN LATERAL (
-         SELECT key_prefix, key_hash
-           FROM api_keys
-          WHERE merchant_id = pl.merchant_id AND revoked_at IS NULL
-          ORDER BY created_at DESC
-          LIMIT 1
-       ) ak ON true
 ...
-    merchantPublicKey: row.merchant_public_key,
-    merchantIntegrationId: row.integration_id,
```
(plus the matching two-line removals from `PublicPaymentLinkRow` and `PublicPaymentLinkDto`)

**Why this is the smallest correct fix:** The change is deletion only. One SQL line is rewritten to drop its trailing comma, and no line of logic is added. *Why not keep the keys and return `null`?* The checkout contract (`apps/web/src/types.ts:9`) says the response must carry no API-key fields at all, and permanently-null fields would just be cruft. *Why not drop only `key_hash`?* The prefix is part of the secret key (`issue.ts`: `rawKey.slice(0, 16)`), not a public identifier. *Why not keep the query and only stop returning the fields?* That leaves a pointless per-request read of `api_keys.key_hash` on a public path. No other code reads the two fields (repo-wide grep).

**Proof:** `create -> public read (active) -> pay (approved) -> public read (paid) -> pay again rejected 409` (`apps/api/src/routes/paymentLinks.test.ts`). The test used to pin the leak with `assert.ok(readActive.json().merchantPublicKey?.startsWith("fp_"))`, a test that encoded the bug. It now asserts that both fields are `undefined` and that the body contains neither `sha256(rawKey)` nor `rawKey.slice(0, 16)`.
Before: `not ok 1 ... actual: 'fp_test_nszkBtgJ'`.
After: the file passes 12/12, and `tsc --noEmit` is clean.

**Regression risk:** Low. The response loses two fields that the checkout never read and that its contract forbids. No other API surface changes. Merchants still see their key prefix in their own authenticated key list.

Lines: prod +1/-16, test +6/-2
