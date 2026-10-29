### ADMIN-IMP-1 · Admin impersonation grants can write as the merchant (super_admin becomes owner) · H3 · Severity: Critical

**What's wrong:** A "view as merchant" grant resolved to the merchant role `owner` for a super_admin and `finance` for a finance admin, and `requireMerchantAuth` let it through on every method. An impersonating admin could therefore create payment links and webhook endpoints, mint API keys (super_admin), and capture or void transactions as the merchant.

**Why it happens:** `apps/api/src/admin/impersonation.ts:85-89` mapped `finance → "finance"` and `super_admin → "owner"`, which contradicts the type's own docstring at `:91`: "merchantRole Always "support" (ARCH §8): a grant is view-only". `auth/requireMerchantAuth.ts:86-97` relied only on per-route `requireMerchantRole` gates ("no second allowlist", `:78-84`). Routes with no role gate, such as `POST /v1/transactions/:id/capture|void`, accepted every grant, including `support`.

**What it breaks:** A finance or super_admin operator who opens a support view of merchant M can `POST /v1/merchants/M/payment-links` (201 today) or void M's authorized transactions (any role). That moves merchant money without any merchant consent or maker-checker step, and the audit log records the actor as the merchant's role. Lane B's AUTHZ-1 depends on grants being read-only.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Impersonation exists so support can see what the merchant sees. Write access turns it into an unaudited back door into every merchant account.

**Fix:** `apps/api/src/admin/impersonation.ts:87-88` and `apps/api/src/auth/requireMerchantAuth.ts:89-90`
```diff
-  finance: "finance",
-  super_admin: "owner",
+  finance: "support",
+  super_admin: "support",
```
```diff
     if (grant) {
+      // ADMIN-IMP-1 (H3): a grant is a read-only support view (ARCH §8); refuse every write.
+      if (request.method !== "GET" && request.method !== "HEAD") throw new ForbiddenError("forbidden");
```
Commit: this commit. Lines: prod +4/-2, test +61/-0.

**Why this is the smallest correct fix:** The grant branch of `requireMerchantAuth` is the single place where an impersonation identity enters the merchant plane, so one method check makes every current and future write route read-only, including routes with no role gate. The mapping change restores the documented `support` scope for reads. Without it, a super_admin's view could pass owner/finance-gated GETs. *Why not add role gates to capture, void and so on?* That means many call sites, and any route added later would be open again. *Why only the mapping?* Ungated write routes would still accept a `support` grant. *Why a generic `"forbidden"` code instead of a new code?* It keeps the existing API error contract that the current test at `routes/admin.test.ts:1109` asserts.

**Proof:** `ADMIN-IMP-1: a {support,finance,super_admin} impersonation grant is read-only` (`apps/api/src/admin/impersonation.audit.test.ts`) fails before the fix. For finance and super_admin, `payment-link create: ... 201 !== 403`. For support, `void: {"error":"transaction_not_found"} 404 !== 403`, meaning the request reached the handler. All three pass after the fix, and `GET /v1/transactions` still returns 200.

**Regression risk:** Impersonated reads are unchanged for support grants. finance and super_admin grants now see only what a support user sees, which is the documented scope. `routes/admin.test.ts` (including the support-impersonation and expired-grant tests), `routes/transactions.test.ts` and `routes/paymentLinks.test.ts` pass.

**Trap note:** The `impersonation.ts:91` docstring already said "Always support". `routes/transactions.ts:91-93` ("MK: impersonation is read-only, enforced in requireMerchantAuth. fine") and `requireMerchantAuth.ts:128` ("YA: impersonation can't reach write routes") claimed an enforcement that did not exist. They are now true. `routes/admin.test.ts:1074` notes that only support was tested, and the audit test covers all three roles.

**Follow-up (adversarial review):** the role-mapping half (every admin role → merchant role `support`) had no test of its own. Added to `impersonation.audit.test.ts`: each grant's GET of the owner/finance-gated `/v1/settlement/reconciliation` must be 403. Proof: with the pre-fix `impersonation.ts` (finance→finance, super_admin→owner) the finance and super_admin cases fail; with the fix all 3 pass. The comment at `auth/requireMerchantAuth.ts:82-84` ("no second ... allowlist") contradicted the new write block and is corrected. Lines: prod 2 comment lines, test +3.
