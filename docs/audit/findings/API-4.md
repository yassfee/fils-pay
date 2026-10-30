### API-4 · Admin "Adjust balance" with a delta past 2^53 fils crashes with a 500 · (no case ref; plainly invalid input must be a 4xx; ADR-0001 integer fils) · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.

**What's wrong:** `POST /v1/admin/merchants/:id/balance-adjustments` with `deltaFils: 1e20`, `-1e20` or `2**53` (finance or super_admin) answered `500 internal_error`, logging `RangeError: toFils: 100000000000000000000 exceeds the safe integer range`.

**Why it happens:** `parseBalanceAdjustmentBody` (`apps/api/src/routes/adminBalanceAdjustments.ts:29`) validates with `Number.isInteger`, which is true for every float above 2^53 (`Number.isInteger(1e20) === true`). Line 40 then calls `toFils` (`packages/money/src/fils.ts:47`), which correctly refuses unsafe integers with a `RangeError`, and nothing maps that to a 4xx. The credit route (`admin/creditRequestValidation.ts`) and the refund route (`routes/refunds.ts:16`, `Number.isSafeInteger`) already reject the same input with 400.

**What it breaks:** an operator typo of extra digits gets "internal error" instead of a validation message, with an error-level log line; the guard that exists only by accident in `toFils` is the one stopping a meaningless 1e20-fils journal entry.

**Why it needed a fix:** money is integer fils (ADR-0001, case file), and a value JavaScript cannot represent exactly is not a valid fils amount; it is a client error and must be a 400 like on the sibling money routes.

**Fix:** `apps/api/src/routes/adminBalanceAdjustments.ts:29`
```diff
-  if (typeof source.deltaFils !== "number" || !Number.isInteger(source.deltaFils)) {
+  if (typeof source.deltaFils !== "number" || !Number.isSafeInteger(source.deltaFils)) { // API-4: toFils throws RangeError past 2^53
```

**Why this is the smallest correct fix:** the existing validation line was simply one predicate too weak; the existing 400 `invalid_request` and its message now cover the case. *Why not catch `RangeError` in the error handler?* `toFils` also guards values read from the database, where a `RangeError` is a real server fault that must stay a 500.

**Proof:** `API-4: a balance adjustment beyond the safe-integer range is a 400, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500`, and passes after, with no ledger entry written for the merchant.

**Regression risk:** only deltas beyond ±(2^53 − 1) fils (about 9 trillion BD) change from 500 to 400. `src/routes/adminBalanceAdjustments.test.ts` passes.

Lines: prod +1/-1, test +16/-0
