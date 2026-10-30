### AUTHZ-1 · A merchant 'support' user can capture and void transactions (no role gate) · H3 · Severity: High

**What's wrong:** `POST /v1/transactions/:id/capture` and `POST /v1/transactions/:id/void` accepted any authenticated merchant identity. A cookie session of the least-privileged merchant role, `support`, could capture an authorization (money moves, MDR is charged) or void a sale.

**Why it happens:** `apps/api/src/routes/transactions.ts:95` and `:123` used only `requireMerchantAuth`. Every other merchant money write adds `requireMerchantRole("owner", "finance")`: `refunds.ts:11`, `paymentLinks.ts:77,101`, `settlement.ts:61,79`, `webhooks.ts:58...165`. `support` is allowed only on read routes (`webhooks.ts:182,218`), and migration `0035` calls it "the least-privileged" role. The faulty assumption was that `requireMerchantAuth` alone was enough. The comments at `:91-93` ("MK: impersonation is read-only, enforced in requireMerchantAuth. fine", "MK: confirmed") talked only about impersonation, never about merchant roles. `:121` left it as a `TODO(FH): role check? ... ask MK`.

**Re-check against ADMIN-IMP-1:** the impersonation half of the lead (an admin grant capturing or voiding, and being mislabelled as `merchant_session`) is already closed. `requireMerchantAuth.ts:90` refuses every non-GET/HEAD request from a grant, so `requireMerchantWriterActor` never sees `admin_impersonation`. Only the merchant-role gap was still reachable, and only that is fixed here.

**What it breaks:** A shop's support agent (a read-only role) logs in and captures or voids any authorized transaction of that merchant. A void cancels a customer's sale, and a capture charges the card and the MDR. Neither needs owner or finance approval, while a refund of the same money already needs it (H3: actions without the right role checks).

**Why it needed a fix:** capture and void move money just as refunds do. With the gate missing, the role model enforced at every sibling route does not hold on the two most direct money paths.

**Fix:** `apps/api/src/routes/transactions.ts:4,93,121`
```diff
-import { requireMerchantAuth, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
+import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
-    { preHandler: requireMerchantAuth },            // capture
+    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
-    { preHandler: requireMerchantAuth },            // void
+    { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] },
```
The misleading `am`/`MK` comments and the `TODO(FH)` are replaced by one line each that states the gate.
Lines: prod +5/-7 (3 code lines, 2 comment lines; 5 stale comment lines removed), test +84/-0.

**Why this is the smallest correct fix:** it uses the existing gate with the same roles as `refunds.ts:11`, so there is no new helper or role list. API keys keep working because `requireMerchantRole` lets key actors through by design, so the server-to-server capture/void contract is unchanged. *Why not owner only, as the TODO hints ("finance shouldn't void")?* That claim is unverified, and every sibling money write allows finance. *Why not a check inside `captureTransaction`/`voidTransaction`?* Those take no role and are also called from internal paths, so the route is the narrowest point.

**Proof:** `AUTHZ-1: a support-role session cannot capture or void; an owner session still can` (`apps/api/src/routes/transactions.audit.test.ts`) failed before the fix with `expected: 403, actual: 200` on the support capture. After the fix, both support calls return 403, both transactions stay `authorized`, and the owner session's capture returns 200.

**Regression risk:** low. API-key and owner/finance session flows are unchanged. `routes/transactions.test.ts` and `routes/refunds.audit.test.ts` pass (19/19 with the new test).

**Trap note:** the comments above the route covered only impersonation and pointed at "ADMIN.md". Once ADMIN-IMP-1 is fixed, those comments are true for impersonation, so it is easy to declare the lead closed and miss the merchant-role gap that remains.
