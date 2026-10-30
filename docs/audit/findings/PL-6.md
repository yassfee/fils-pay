### PL-6 · Public payment-link read exposed the API key's SHA-256 · Severity: Low

**Lead:** Team 45 heads-up list (P1) and our 03_findings PL-6, verified by us.
**Category:** Bug

**What's wrong:** `GET /v1/payment-links/:token` is public and unauthenticated. Besides the merchant's display name and `merchantPublicKey` (the 16-character `key_prefix` of the newest unrevoked API key), it returned `merchantIntegrationId`: that key's `key_hash`, the exact SHA-256 verifier that API-key authentication looks up. Anyone holding a link token could read it.

**Why it happens:** `apps/api/src/paymentLinks/read.ts:40-53` (before the fix) joined `api_keys` through a `LEFT JOIN LATERAL` and selected `ak.key_prefix AS merchant_public_key, ak.key_hash AS integration_id`, and the response copied both. The rest of the codebase withholds `api_keys.key_hash` on purpose (`admin/merchants.ts:214-217`: the admin view "can never accidentally expose a field those views deliberately withhold (`api_keys.key_hash`, …)"), and `apiKeys/issue.ts:7` says "only key_hash is stored". The hosted checkout reads neither field.

**What it breaks:** The stored credential verifier of the merchant's live key is published on a surface anyone can reach by forwarding, logging or screenshotting a link. It also changes on rotation, so it tells an outsider when the merchant rotates. A SHA-256 of a 192-bit random secret cannot be reversed, so this is not a direct takeover; it is exposure of credential material the system otherwise never shows, even to admins. Hence Low.

**Why it needed a fix:** Credential verifiers do not belong on an unauthenticated endpoint, and the codebase's own rule is to never expose `key_hash`.

**What we kept: the key prefix.** Our first commit (`5759285`) also removed `merchantPublicKey`. We restored it in `f198a66`. It is a designed public identifier: the original read code selects it under that name, the original test pins it (`routes/paymentLinks.test.ts:126` at `8b58b0f`: `merchantPublicKey?.startsWith("fp_")`), and the 8 random characters it carries after `fp_live_` (48 of the key's 192 random bits) leave 144 unknown bits, which is not exploitable. The web DTO comment "The server must never add API-key fields to this response" (`apps/web/src/types.ts:9`, Fatima Haji) arguably covers the prefix too; we did not treat that comment as outranking the API's own test.

**Fix (net):** `apps/api/src/paymentLinks/read.ts`: `key_hash` leaves the LATERAL subquery and the SELECT, and `integration_id` / `merchantIntegrationId` leave the row type, the DTO and the response. The doc comment is corrected.
```diff
-/** Public shape. Contains nothing that identifies or authenticates the merchant beyond its display name. */
+/** Public shape. Identifies the merchant by display name and public key prefix only; never the key hash (PL-6). */
-            ak.key_prefix AS merchant_public_key,
-            ak.key_hash AS integration_id
+            ak.key_prefix AS merchant_public_key
-         SELECT key_prefix, key_hash
+         SELECT key_prefix
-    merchantIntegrationId: row.integration_id,
```
(plus the matching one-line removals from `PublicPaymentLinkRow` and `PublicPaymentLinkDto`)

**Why this is the smallest correct fix:** deletion only, plus one SQL line rewritten to drop its trailing comma and the corrected doc comment. *Why not return `null`?* A permanently-null field is cruft. No other code reads `merchantIntegrationId` (repo-wide grep).

**Proof:** `create -> public read (active) -> pay (approved) -> public read (paid) -> pay again rejected 409` (`apps/api/src/routes/paymentLinks.test.ts`) still asserts the prefix starts with `fp_` (the original assertion) and now also asserts `merchantIntegrationId` is `undefined` and that the body does not contain `sha256(rawKey)`. Before the fix the hash assertions failed; after, the file passes and `tsc --noEmit` is clean.

**Regression risk:** Low. The response loses one field that the checkout never read. The prefix field is unchanged from the original.

Lines: prod +3/-7 net (read.ts; per-commit `5759285` +1/-16, `f198a66` +13/-2), test +5/-2 net (paymentLinks.test.ts, excluding PL-5's test in the same file)
