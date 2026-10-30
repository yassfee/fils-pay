### AUTH-12 · A suspended or closed merchant keeps transacting through live sessions, API keys and payment links ·  · Severity: High

**Lead:** Team 45 heads-up list (P12), verified by us.

**What's wrong:** `merchants.status` (`active | suspended | closed`, `db/migrations/0002_merchants.sql:7-8`) was enforced only at password login (`apps/api/src/routes/auth.ts:63`, `auth/users.ts:19`). Once a merchant was suspended, its existing dashboard sessions, its API keys and its public payment links all kept working. It could authorize, capture, refund and create links as if nothing had happened.

**Why it happens:** None of the three entry points that admit a merchant read `merchants.status`. `lookupSession` (`auth/sessions.ts:89-92`) joins only `merchant_users`. `verifyApiKey` (`apiKeys/verify.ts:18-20`) reads only `api_keys`. `authorizeTransaction` (`payments/authorize.ts:77-87`), which the public `/v1/payment-links/:token/pay` reaches with no merchant credential at all, checks `onboarding_status` but not `status`.

**What it breaks:** Ops suspends a merchant (for example on a fraud or AML hold). The audit test then gets, from the same suspended merchant, `201` on an API-key `POST /v1/transactions`, `200` on a session `GET /v1/transactions`, and `200` on a buyer paying one of its payment links, with 2 transactions created. Its refund and capture routes stay open too, so a suspended merchant can still push money out. Suspension does nothing except block new password logins.

**Why it needed a fix:** Suspension is the platform's kill switch for a merchant. If it does not stop live credentials and public links, a merchant under investigation keeps taking card payments and issuing refunds, which is a direct financial and compliance exposure.

**Fix:** `apps/api/src/auth/sessions.ts:92`, `apps/api/src/apiKeys/verify.ts:19`, `apps/api/src/payments/authorize.ts:77-78, 87`
```diff
        JOIN merchant_users mu ON mu.id = s.merchant_user_id
+       JOIN merchants m ON m.id = mu.merchant_id AND m.status = 'active' -- AUTH-12: login already requires this
       WHERE s.token_hash = $1 AND s.authenticated = true`,
```
```diff
-    `SELECT id, merchant_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
+    `SELECT k.id, k.merchant_id FROM api_keys k JOIN merchants m ON m.id = k.merchant_id AND m.status = 'active' WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, // AUTH-12
```
```diff
-    const merchantResult = await client.query<{ onboarding_status: string; mdr_bps: number }>(
-      `SELECT onboarding_status, mdr_bps FROM merchants WHERE id = $1`,
+    const merchantResult = await client.query<{ onboarding_status: string; mdr_bps: number; status: string }>(
+      `SELECT onboarding_status, mdr_bps, status FROM merchants WHERE id = $1`,
 ...
-    if (!merchant || merchant.onboarding_status !== "approved") {
+    if (!merchant || merchant.onboarding_status !== "approved" || merchant.status !== "active") { // AUTH-12: suspended/closed: no new charges
```

**Why this is the smallest correct fix:** These are the only three ways a merchant gets in. Both cookie middlewares (`auth/middleware.ts:38`, `auth/requireMerchantAuth.ts:49`) go through `lookupSession`. Both API-key paths (`apiKeys/verify.ts:40`, `auth/requireMerchantAuth.ts:64`) go through `verifyApiKey`. The credential-less public pay path goes through `authorizeTransaction`. Each fix adds one predicate to a query that already runs, with no extra round trip, and the session predicate mirrors the one login already applies. A suspended merchant's credentials now behave like a revoked key (401 `unauthenticated`, an existing response), and a payment-link charge gets the existing 403 `merchant_not_approved` (as `{stage:"authorize", error:"merchant_not_approved"}`). No new error shapes are introduced. *Why not one check in `requireMerchantAuth`?* `requireApiKey` (the authorize route) and `requireSession` do not use it, and the public pay path has no auth middleware. *Why not only the authorize check?* Capture, void and refund on existing authorizations would stay open.

**Proof:** `AUTH-12: a suspended merchant's session, API key and payment link can no longer transact` (`apps/api/src/routes/transactions.audit.test.ts`).
Before: `actual: { apiKey: 201, session: 200, link: 200, transactions: 2 }`.
After: `{ apiKey: 401, session: 401, link: 403, transactions: 0 }`. The audit, transactions, payment-link, app, auth-audit, `auth/*` and `apiKeys/*` suites pass 53/53, and `tsc --noEmit` is clean.

**Regression risk:** Low. Only merchants whose `status` is not `active` are affected. No code sets that status today, and no test relies on a non-active merchant authenticating. Reactivating (`status = 'active'`) restores every credential immediately, because nothing is revoked. Admin impersonation (read-only, ADMIN-IMP-1) still lets support inspect a suspended merchant.

Lines: prod +5/-4, test +39/-0
