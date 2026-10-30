### ADMIN-IDEM-1 · A double-submitted admin credit or balance adjustment posts to the ledger twice · · Severity: High

**Lead:** Team 45 heads-up list (SEC3), verified by us.

**What's wrong:** The two admin operations that move a merchant's money, "Issue credit" (`POST /v1/admin/merchants/:id/credits`) and "Adjust balance" (`POST /v1/admin/merchants/:id/balance-adjustments`), have no idempotency at all. A double-click, a browser retry or a resent request journals the same money a second time, and the cached balance moves twice.

**Why it happens:** `createCreditRequest` (`apps/api/src/admin/credits.ts:202-284`) inserts a new `credit_requests` row and, under the 50.000 BD threshold, posts it to the ledger on every call. `adjustMerchantBalanceJournaled` (`apps/api/src/admin/balanceAdjustments.ts:67-114` before) posts a ledger adjustment and bumps `merchant_balances` on every call. Neither route reads an `Idempotency-Key`, unlike the merchant money endpoints (authorize, capture, refund), which claim one through `claimIdempotencyKey` (`apps/api/src/payments/idempotency.ts:110`). The admin forms (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx`) send nothing that could deduplicate a resubmit.

**What it breaks:** A finance admin issues a 12.345 BD goodwill credit and the request is sent twice (double-click or retry): two `credit_requests`, two posted ledger groups, `merchant_payable` +24,690 fils instead of +12,345, paid out at the next settlement. A 50.000 BD balance correction sent twice moves the cache from 100,000 to 200,000 fils and journals 100,000 fils. Reproduced by the tests below: two concurrent submits produce two different credit ids, and two adjustments leave the balance at 200,000 fils.

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

**Regression risk:** Requests without the header behave exactly as before. A UI submit that failed with a 4xx/5xx keeps its key, which is safe because failed attempts roll back their claim. `applyBalanceCorrection` (cache-only, not routed) is unchanged apart from the optional field on the shared input type.

Lines: prod +19/-4 api (credits.ts +8/-2, balanceAdjustments.ts +9/-2, routes +2) and +10/-3 admin UI, test +51/-0
