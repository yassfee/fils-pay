### ADMIN-IDEM-1 · A double-submitted admin credit posts to the ledger twice · Severity: High

**Lead:** Team 45 heads-up list (SEC3), verified by us.
**Category:** Bug

**What's wrong:** "Issue credit" (`POST /v1/admin/merchants/:id/credits`) has no idempotency at all. A double-click, a browser retry or a resent request journals the same credit a second time. That credit double-post is the handed-over bug.

**The adjustment half is ours:** "Adjust balance" (`POST /v1/admin/merchants/:id/balance-adjustments`) posts to the ledger only since our ADJ-1 fix (`4517985`), which switched the route from the cache-only `applyBalanceCorrection` to the existing `adjustMerchantBalanceJournaled`. Before ADJ-1 a double adjustment moved only the cache twice (itself the ADJ-1 defect); a double ledger posting from this route did not exist in the handed-over code. We closed it in the same commit because ADJ-1 created it, so it is a follow-up to our own change, not a second handed-over bug.

**Why it happens:** `createCreditRequest` (`apps/api/src/admin/credits.ts:202-284`) inserts a new `credit_requests` row and, under the 50.000 BD threshold, posts it to the ledger on every call. `adjustMerchantBalanceJournaled` (`apps/api/src/admin/balanceAdjustments.ts:67-114` before; routed since ADJ-1) posts a ledger adjustment and bumps `merchant_balances` on every call. Neither route reads an `Idempotency-Key`, unlike the merchant money endpoints (authorize, capture, refund), which claim one through `claimIdempotencyKey` (`apps/api/src/payments/idempotency.ts:110`). The admin forms (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`) send nothing that could deduplicate a resubmit.

**What it breaks:** A finance admin issues a 12.345 BD goodwill credit and the request is sent twice (double-click or retry): two `credit_requests`, two posted ledger groups, `merchant_payable` +24,690 fils instead of +12,345, paid out at the next settlement. (Since ADJ-1, a 50.000 BD balance correction sent twice would likewise move the cache from 100,000 to 200,000 fils and journal 100,000 fils.) Reproduced by the tests below: two concurrent submits produce two different credit ids, and two adjustments leave the balance at 200,000 fils.

**Why it needed a fix:** These are the manual money paths finance relies on to correct balances; a correction that can silently double is a new reconciliation gap of exactly the kind the case file's finance notes chase (F4, F7).

**Fix:** `apps/api/src/admin/credits.ts:6-7,205,218-221,282`, `apps/api/src/admin/balanceAdjustments.ts:5-6,15,83-85,112,118-119`, the two routes, and the admin UI.
```diff
 // credits.ts, inside the existing transaction, after the merchant check
+    // ADMIN-IDEM-1: a double-submit with the same key waits on this claim, then replays the first credit.
+    const claim = input.idempotencyKey === undefined ? undefined : await claimIdempotencyKey(client, { merchantId: input.merchantId, endpoint: "admin.credits.create", key: input.idempotencyKey, requestHash: hashRequest(input.body) });
+    if (claim?.outcome === "replay") return readRecord(client, claim.row.resourceId!);
+    if (claim && claim.outcome !== "fresh") throw new UnprocessableEntityError("idempotency_key_reused");
 ...
+    if (claim) await completeIdempotencyKey(client, claim.row.id, { statusCode: 201, body: { id: creditRequestId }, resourceId: creditRequestId });
     return readRecord(client, creditRequestId);
```
```diff
 // balanceAdjustments.ts (journaled variant, the one the route calls), after the balance row lock
+    const claim = input.idempotencyKey === undefined ? undefined : await claimIdempotencyKey(client, { merchantId: input.merchantId, endpoint: "admin.balance_adjustments.create", key: input.idempotencyKey, requestHash: hashRequest({ deltaFils: input.deltaFils, reason: input.reason }) });
+    if (claim?.outcome === "replay") return claim.row.responseBody as BalanceAdjustmentResult;
+    if (claim && claim.outcome !== "fresh") throw new UnprocessableEntityError("idempotency_key_reused");
 ...
-    return {
+    const result: BalanceAdjustmentResult = {
 ...
+    if (claim) await completeIdempotencyKey(client, claim.row.id, { statusCode: 200, body: result });
+    return result;
```
Routes: `idempotencyKey: request.headers["idempotency-key"] as string | undefined` (one line each). Admin UI: `issueCredit` and `adjustBalance` (`apps/admin/src/api/credits.ts`, `balanceAdjustments.ts`) take the key and send it as the `Idempotency-Key` header; `MerchantDetailPage.tsx` keeps one key per form in state (`useState(() => crypto.randomUUID())`) and mints a new one only after a successful submit, so a double-click or retry of the same form reuses it while the next credit gets a fresh key.

The claim runs inside each operation's existing transaction, so the key commits or rolls back with the posting. A concurrent second submit blocks on the `idempotency_keys` unique index (credits) or on the balance row lock (adjustments) until the first commits, then sees the completed key and replays: the credit's current record, or the adjustment's stored before/after. The same key with a different body is refused with 422 `idempotency_key_reused`, as on capture.

**Why this is the smallest correct fix:** it reuses the platform's existing idempotency table and claim/complete functions, at the one function each route calls; no migration (the key is scoped by the target merchant, as `idempotency_keys` requires). *Why not make the header mandatory?* It would break every existing API client and test of these routes; the admin UI now always sends it, which is where double-submits come from. *Why not only disable the button in the UI?* A browser or proxy retry still resends the request; the server must deduplicate. *Why not dedupe on identical bodies without a key?* Two identical credits can be legitimate.

**Proof:** `ADMIN-IDEM-1: a double-submitted credit with one Idempotency-Key posts to the ledger once` (`apps/api/src/routes/adminCredits.test.ts`) fails before the fix with `expected: 'b32901df-…' actual: '6ef05f1f-…'` (two credits). `ADMIN-IDEM-1: a double-submitted balance adjustment with one Idempotency-Key is applied once` (`apps/api/src/routes/adminBalanceAdjustments.test.ts`) fails before with the second response showing a second move (before 150,000 → after 200,000). After: both pass (one `merchant_payable` leg, 12,345 fils / balance 150,000; replayed body identical; different body with the same key → 422). The credits, balance-adjustment route and unit tests pass (42/42); `apps/admin` typechecks.

**Regression risk:** The header is optional (advisor condition): present = dedupe, absent = exactly as before. Pinned by `ADMIN-IDEM-1: without an Idempotency-Key two identical credits are both posted, as before` (`routes/adminCredits.test.ts`) and `ADMIN-IDEM-1: without an Idempotency-Key two identical adjustments are both applied, as before` (`routes/adminBalanceAdjustments.test.ts`), both passing. A UI submit that failed with a 4xx/5xx keeps its key, which is safe because failed attempts roll back their claim. `applyBalanceCorrection` (cache-only, not routed) is unchanged apart from the optional field on the shared input type.

Lines: prod +19/-4 api (credits.ts +8/-2 for the bug; balanceAdjustments.ts +9/-2 for the ADJ-1 follow-up; routes +2, one each) and +10/-3 admin UI (both forms) = 36 lines, advisor-approved (over the 30-line rule; approved on the condition that the header stays optional); test +51/-0, then +26/-0 for the header-absent tests
