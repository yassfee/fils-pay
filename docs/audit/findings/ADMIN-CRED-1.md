### ADMIN-CRED-1 · Credit creation has no role gate: a support admin can post credits · H3 · Severity: Critical

**What's wrong:** `POST /v1/admin/merchants/:id/credits` required only an admin session. A `support` admin could create credits, and any below-threshold credit posts straight to the ledger with no approver.

**Why it happens:** In `apps/api/src/routes/adminCredits.ts:41-77` the create route sits in the first `register()` scope, which has only `requireAdminSession`. Only the approve and reject scope (`:79-81`) adds `requireAdminRole("finance", "super_admin")`. `createCreditRequest` (`admin/credits.ts:201-203`) claimed "a support caller gets a 403 from here", but it performs no role check.

**What it breaks:** A support admin sends 20 requests of `baseAmountFils: 50_000` with `reverseFee` to a 320 bps merchant. Each one posts 51,600 fils with `requires_approval = false`, so 1,032,000 fils (1,032.000 BD) is credited to `merchant_payable` and no finance user is ever involved.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Money-out credits are a finance control, and the least-privileged role could bypass it without limit.

**Fix:** `apps/api/src/routes/adminCredits.ts:64`
```diff
       "/merchants/:id/credits",
+      { preHandler: requireAdminRole("finance", "super_admin") }, // ADMIN-CRED-1 (H3)
       async (request, reply) => {
```
The misleading doc line is corrected at `admin/credits.ts:203`. Commit: this commit. Lines: prod +2/-1 (1 code, 1 comment), test +17/-0.

**Why this is the smallest correct fix:** A per-route `preHandler` runs after the scope's `requireAdminSession` hook, so `adminAuth` is already set, and it reuses the existing `requireAdminRole`. *Why not move the route into the second `register()` block?* That moves about 15 lines for the same effect. *Why not check the role inside `createCreditRequest`?* That is a signature change, and the route layer is where every other admin role gate lives. Support keeps read access to `GET /v1/admin/credits`.

**Proof:** `ADMIN-CRED-1: a support admin is 403'd on create and nothing is journaled` (`apps/api/src/routes/adminCredits.test.ts`) fails before the fix with `assert.equal(res.statusCode, 403, res.body)` → `201 !== 403`. It passes after the fix. No `credit_requests` row is created.

**Regression risk:** Finance and super_admin creation is unchanged. `routes/adminCredits.test.ts`, `admin/credits.test.ts` and `admin/creditApproval.test.ts` all pass (23/23).

**Trap note:** `admin/credits.ts:203` ("a support caller gets a 403 from here") is corrected to point at the route gate. `adminCredits.test.ts:139` ("create isn't in this test, only approve/reject. intentional? — am") is answered by the new test directly above it. `docs/ADMIN.md:9` (support may "issue small credits") is outside this lane's owned files and contradicts H3; it is listed for the lead.
