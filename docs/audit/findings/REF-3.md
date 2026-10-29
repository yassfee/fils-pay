### REF-3 · Refund ceiling uses the authorized amount, not the captured amount · H1 · Severity: Critical

**What's wrong:** `processRefund` works out how much may still be refunded as `amount_fils - refunded_fils`, where `amount_fils` is the authorized amount. A partially captured transaction can therefore refund money that was never charged.

**Why it happens:** `apps/api/src/payments/processRefund.ts:90` computed `subtractFils(amountAuthorized, refundedFils)` and passed it to `validateRefundRequest` as `refundableFils`. The validator (`refundValidation.ts:38-46`) trusts that number. The faulty assumption was that authorized equals captured; it does not after a partial capture. Two things hid the bug. The test helper `refundValidation.test.ts:22` built `refundableFils` from `amountFils`, the same mistake. Two comments then presented it as intended: `:55` "it can refund up to the authorized amount" and `:73` "the authorized amount, by design".

**What it breaks:** Authorize 10,000 fils and capture 4,000 fils (status `partially_captured`). Before the fix, a refund of 10,000 fils was approved (200), the acquirer paid out 10,000 fils, and the merchant got back 6,000 fils that the buyer never paid. This is exactly case file H1: "can you refund more than what was actually charged?"

**Why it needed a fix:** Any merchant with a partial capture (hotels, pre-auth flows) could take out up to the uncaptured part of the authorization as cash. The platform would carry that loss.

**Fix:** `apps/api/src/payments/processRefund.ts:90`
```diff
-    const refundableFils = subtractFils(amountAuthorized, refundedFils);
+    const refundableFils = subtractFils(capturedFils, refundedFils);
```
Commit: this commit. Lines: prod +1/-1, test +21/-3 (new test +18; corrected helper +1/-1 and 2 corrected comments +2/-2 in `refundValidation.test.ts`).

**Why this is the smallest correct fix:** It changes one operand at the single place the ceiling is computed. The validator and its 422 `refund_exceeds_refundable` contract stay as they are.
- Why not change `validateRefundRequest` to compute `capturedFils - refunded` itself: that changes the `RefundableTransaction` shape and every caller and test, which is more lines for the same result.
- Why not cap the amount inside `refundableAmount()`: that would hide the wrong input instead of fixing where it comes from.

**Proof:** The new test `REF-3: a refund above the captured amount is refused even when the authorization is larger` (`processRefund.test.ts`) failed before the fix with `expected: 422, actual: 200`. After the fix it passes: 422 `{ code: "refund_exceeds_refundable", refundableFils: 4000 }`. Refund suites: 35 pass, 0 fail.

**Regression risk:** For fully captured transactions captured equals authorized, so nothing changes. `amountAuthorized` is still used for `nextStatusAfterRefund`. Covered by processRefund, initiateMerchantRefund, refundValidation and refundState tests.

**Trap note:** The test helper at `refundValidation.test.ts:22` encoded the bug (`amountFils - refundedFils`). It now uses `capturedFils - refundedFils`. The `// MK:` comment (:55) and the "by design" JSDoc (:73) are rewritten to cite H1.
