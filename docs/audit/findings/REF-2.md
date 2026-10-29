### REF-2 · Any merchant can refund another merchant's transaction · FP-300 · Severity: Critical

**What's wrong:** `initiateMerchantRefund` loads the target transaction by id alone and passes on the transaction's own `merchant_id`, so merchant A can refund merchant B's transaction by sending B's `transactionId` in the body.

**Why it happens:** `apps/api/src/refunds/initiateMerchantRefund.ts:62-65` ran `SELECT id, merchant_id FROM transactions WHERE id = $1`. The result was never compared with `input.merchantId`, which the route has already checked against the session (`assertRefundRequestScope`). `:73` then passes `merchantId: txn.merchant_id`, the victim's id, to `processRefund`, whose own lookup (`processRefund.ts:73-78`) is also by id only. The faulty assumption was that the path-scope check covers the body's `transactionId`. It only proves who the caller is, not that the caller owns the transaction. A misleading comment hid this (`initiateMerchantRefund.test.ts:170-171`): "TODO: another merchant's existing transactionId should also 404. currently refunds it" followed by "FH: Claude wrote a test for this but it passed?? so it's fine. deleted it as redundant".

**What it breaks:** Merchant B captures 10,000 fils. Merchant A calls `initiateMerchantRefund` with B's transaction id. Before the fix the call succeeds: B's transaction is refunded 10,000 fils, B's `merchant_payable` is debited, and the money goes back to B's buyer. The whole action is driven by A, and the idempotency key is filed under B.

**Why it needed a fix:** Once FP-300 wires the route, any merchant with an API key could drain any other merchant's balance through refunds. Transaction ids also appear in webhooks, receipts and payment-link data.

**Fix:** `apps/api/src/refunds/initiateMerchantRefund.ts:63-64`
```diff
-    `SELECT id, merchant_id FROM transactions WHERE id = $1`,
-    [input.transactionId],
+    `SELECT id, merchant_id FROM transactions WHERE id = $1 AND merchant_id = $2`,
+    [input.transactionId, input.merchantId],
```
Commit: this commit. Lines: prod +2/-2, test +20/-2.

**Why this is the smallest correct fix:** It scopes the lookup by the caller's merchant at the single point where the transaction is picked. A foreign id then takes the existing `transaction_not_found` 404 path, so another merchant's id cannot be told apart from a missing one (no existence oracle).
- Why not compare `txn.merchant_id !== input.merchantId` and throw 403: that adds lines and reveals that the id exists.
- Why not also scope `processRefund`'s lookup: its only production caller is `initiateMerchantRefund`, which now passes a verified owner. Scoping it too would be defence in depth that the FP-300 builder can add when wiring the route.

**Proof:** The new test `REF-2: another merchant's existing transactionId is a 404 and refunds nothing` (`initiateMerchantRefund.test.ts`) failed before the fix with `Missing expected rejection (NotFoundError).`. After the fix it passes, and `refunded_fils` stays 0. processRefund + initiateMerchantRefund: 21 pass, 0 fail.

**Regression risk:** Own-merchant refunds are unchanged ("a full/partial refund of the caller's own transaction succeeds"). The unknown-id 404 test still passes.

**Trap note:** The `TODO`/`FH:` comment at `initiateMerchantRefund.test.ts:170-171` claimed a deleted test had "passed" and that the case was "fine". That comment is replaced by the restored test.
