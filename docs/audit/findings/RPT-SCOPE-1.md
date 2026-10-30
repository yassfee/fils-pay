### RPT-SCOPE-1 · Any merchant can read any split child's transactions through the report filter · Severity: High

**What's wrong:** `GET /v1/reporting/transactions?filter={"merchantId":"<id>"}` returned another merchant's transactions whenever `<id>` was a split child of *any* parent. The caller did not have to be that parent.

**Why it happens:** `apps/api/src/reporting/scope.ts:12-15` checked only `WHERE child_merchant_id = $1`. It never compared `parent_merchant_id` (migration `0045`, which has both columns) with `callerMerchantId`. On a hit it returned the requested id, and `runTransactionsReport` then scoped `merchant_id = $1` to that merchant. The faulty assumption was that "is a split child" means "is the caller's split child". The docstring at `transactionsReportQuery.ts:4-8` hid the problem by claiming `merchantId` "is always overwritten by the route with the authenticated merchant". `transactionsReportQuery.test.ts:82` ("named merchant = the merchant in the filter ... intended for the marketplace case (MK)") and `savedFilters.test.ts` never test a foreign child.

**What it breaks:** merchant A (any role, cookie or API key) sends `filter={"merchantId":"<Delta Marketplace sub-merchant>"}` and receives that sub-merchant's 500 most recent transactions: ids, amounts, captured amounts, references and timestamps. Sibling sub-merchants can also read each other. A saved filter that names a foreign id replays the leak.

**Why it needed a fix:** this is a cross-tenant data leak on a merchant-facing read route.

**Fix:** `apps/api/src/reporting/scope.ts:13-14`
```diff
-    `SELECT 1 AS ok FROM merchant_split_children WHERE child_merchant_id = $1`,
-    [requestedMerchantId],
+    `SELECT 1 AS ok FROM merchant_split_children WHERE child_merchant_id = $1 AND parent_merchant_id = $2`,
+    [requestedMerchantId, callerMerchantId],
```
The false docstring at `transactionsReportQuery.ts:5-7` is rewritten to describe what actually happens (3 comment lines).
Lines: prod +5/-5 (2 code, 3 comment), test +31/-0.

**Why this is the smallest correct fix:** the scope decision lives in one function, and adding one predicate plus one bind parameter closes the leak. The existing fallback (an unknown or foreign id resolves to the caller) stays unchanged, so the route contract is the same. The table's `UNIQUE (parent_merchant_id, child_merchant_id)` index covers the lookup. *Why not drop `filter.merchantId` altogether?* That would break the marketplace parent's documented view of its children. *Why not a 403 on a foreign id?* That changes the API contract, and the existing fallback already avoids an existence oracle.

**Proof:** `RPT-SCOPE-1: only the parent may scope a report to its split child` (`apps/api/src/reporting/scope.audit.test.ts`) failed before the fix: `resolveReportMerchantId(pool, stranger, child)` returned the child's id instead of the stranger's ("a non-parent read a split child's report"). After the fix it returns the stranger's own id, and the parent still resolves to the child.

**Regression risk:** low. Only non-parent callers lose access. `reporting/transactionsReportQuery.test.ts`, `reporting/savedFilters.test.ts` and `routes/reporting.audit.test.ts` pass (11/11 with the new test).

**Trap note:** the docstring stated the opposite of what the code did. The MK test comment presents the filter-named merchant as intended, which makes the leak look like a feature.
