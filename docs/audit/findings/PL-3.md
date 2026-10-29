### PL-3 · Payment-link cancel is a cross-merchant IDOR · G5 · Severity: High

**What's wrong:** `DELETE /v1/merchants/:merchantId/payment-links/:id` cancels any active link by id. Merchant A can cancel merchant B's link by putting A's own merchant id in the path and B's link id after it, which is case file G5: "I cancelled merchant B's payment link from merchant A's dashboard".

**Why it happens:** `apps/api/src/paymentLinks/cancel.ts:13-19` ran `UPDATE payment_links ... WHERE id = $1 AND status = 'active'` with no `merchant_id`. The route (`routes/paymentLinks.ts:103-107`) passed only the link id. The faulty assumption was that `assertOwnMerchant` covers ownership. It only proves the caller is the path merchant. Two comments hid this. `routes/paymentLinks.ts:50` said "this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs" (MK's line under it already doubted it). `cancel.ts:24` said "second read is just for the error shape, no race. fine", and that read also leaked another merchant's link status through the 409 body.

**What it breaks:** Merchant B creates a 4,750 fils link and sends it to a buyer. Merchant A sends `DELETE /v1/merchants/A/payment-links/<B's link id>` with A's key and gets 204. B's link is now `canceled`, and the buyer's 4,750 fils payment is refused (sale lost). Link ids reach third parties (buyers, chat apps), so they are not secrets.

**Why it needed a fix:** Any merchant can disrupt any competitor's payment collection. The 409 path also tells the attacker the status of any link it knows the id of.

**Fix:** `apps/api/src/paymentLinks/cancel.ts:11,16,18,24,26,27` and `apps/api/src/routes/paymentLinks.ts:107`
```diff
-  input: { id: string },
+  input: { id: string; merchantId: string },
-      WHERE id = $1 AND status = 'active'
+      WHERE id = $1 AND merchant_id = $2 AND status = 'active'
-    [input.id],
+    [input.id, input.merchantId],
-  // YA: second read is just for the error shape, no race. fine
+  // Same merchant scope as the UPDATE (PL-3): another merchant's link is not_found, not a status oracle.
-    `SELECT status FROM payment_links WHERE id = $1`,
-    [input.id],
+    `SELECT status FROM payment_links WHERE id = $1 AND merchant_id = $2`,
+    [input.id, input.merchantId],
 (routes/paymentLinks.ts)
+        merchantId: request.params.merchantId,
-// am: this is the ownership check for create/cancel/list. cancel.ts relies on it, link ids are UUIDs
-// MK: it checks the path merchant, not that the link belongs to that merchant?
+// Path-scope check only: it proves the caller IS the path merchant, not that a link belongs to it.
+// cancel.ts scopes its queries by merchant_id itself (PL-3).
```
Commit: this commit. Lines: prod +9/-8 (code +6/-5, comments +3/-3), test +16/-0.

**Why this is the smallest correct fix:** It adds the owner predicate to the two queries that touch the row and passes in the merchant id that the route has already scope-checked. A foreign link then takes the existing `not_found` 404 path.
- Why not scope only the UPDATE: the follow-up SELECT would still return 409 with the other merchant's link status (an oracle).
- Why not add a separate ownership SELECT in the route: that is more lines and a check-then-act gap.
- Why not return 403: a 403 confirms that the link id exists.

**Proof:** The new test `PL-3: a merchant cannot cancel another merchant's payment link (404, link stays active)` (`routes/paymentLinks.test.ts`) failed before the fix with `expected: 404`, `actual: 204`. After the fix it passes and the link stays `active`. routes/paymentLinks + paymentLinks/pay + status: 20 pass, 0 fail.

**Regression risk:** Own-merchant cancel is unchanged ("cancel: happy path 204, nonexistent id -> 404, already-paid -> 409" still passes). `cancelPaymentLink` has no other callers.

**Trap note:** The `am:`/`MK:` comment at `routes/paymentLinks.ts:50-51` called the path check "the ownership check" that cancel.ts "relies on". It is rewritten to say what the check actually proves. The `YA: ... no race. fine` comment at `cancel.ts:24` is replaced.
