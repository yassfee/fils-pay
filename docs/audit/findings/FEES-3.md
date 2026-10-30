### FEES-3 · Payment-link captures never get the negotiated discount; the webhook and timeline report the pre-discount fee · FP-300 ☐3 · Severity: High

**What's wrong:** Only the merchant capture route applied the negotiated discount. `POST /v1/payment-links/:token/pay` calls `captureTransaction` directly and books the full MDR fee. On every capture path, the `transaction.captured` outbox payload (the merchant webhook) and the timeline `metadata.feeFils` carried the fee before the discount.

**Why it happens:** `applyCaptureDiscountAdjustment` (`apps/api/src/payments/discountAdjustment.ts`) was called from one place only, `apps/api/src/routes/transactions.ts:107-115` (before the fix), after `captureTransaction` had committed, in a second DB transaction. `apps/api/src/paymentLinks/pay.ts:123` goes straight from capture to finalize. Before the fix `capture.ts` never read `negotiated_discount_bps`, despite MK's note at `pay.ts:113` ("moved into capture.ts in July").

**What it breaks:** Delta Marketplace terms (275 bps MDR, 1250 bps discount), a 100,000-fils link: the ledger books a 2,750 fee and no discount, so `merchant_payable` is 97,250 instead of 97,594 and `platform_fee_revenue` is 344 fils too high. The webhook reports `feeFils` 2,750. With 12,345 fils at 250 bps and a 1500 bps discount, the link path books 309, the API path 263, and Go `CloseBatch` 262, so three numbers exist for one sale. The post-commit step also had a gap: if it threw, the capture was committed without its discount.

**Why it needed a fix:** Case file ☐3, "Fees and payouts come out right", and ☐2, "money is right in the ledger, down to the fils". FP-300 refunds (REF-7) reverse the fee booked in the ledger, so a link capture would be refunded at the undiscounted fee. User decision 2026-10-30 (option A): one fee per capture, booked once at capture time using the fee-first formula, and everything downstream uses that booked fee.

**Fix:** `apps/api/src/payments/capture.ts:153-154,197,233-240,256,267`; `apps/api/src/routes/transactions.ts:7,105-113` (removed)
```diff
-    const merchantResult = await client.query<{ mdr_bps: number }>(
-      `SELECT mdr_bps FROM merchants WHERE id = $1`,
+    const merchantResult = await client.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
+      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
 ...
     const feeFils = applyRateFils(requestedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps));
+    const discountFils = applyRateFils(feeFils, merchant.negotiated_discount_bps); // FEES-3: off the fee, after MDR, every entry point
 ...
+    if (discountFils > 0) {
+      await client.query(
+        `INSERT INTO ledger_entries (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
+         VALUES ($1, $2, $3, 'platform_fee_revenue', 'debit',  $4, now(), 'capture: negotiated discount adjustment'),
+                ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: negotiated discount adjustment')`,
+        [entryGroupId, input.merchantId, txn.id, discountFils],
+      );
+    }
 ...
-        feeFils,
+        feeFils: subtractFils(feeFils, discountFils),
 ...
-      metadata: { feeFils, acquirerReference: acquirerResult.acquirerReference },
+      metadata: { feeFils: subtractFils(feeFils, discountFils), acquirerReference: acquirerResult.acquirerReference },
```
In `routes/transactions.ts` the `applyCaptureDiscountAdjustment` import and the post-commit call, with its 3 comment lines (MK/am), are deleted. Without that deletion the API path would discount twice. The fee is still MDR from the schedule minus the platform tier, then the discount is taken off that rounded fee: 12,345 × 250 bps = 308.625 → 309 (half-to-even), 15% of 309 = 46.35 → 46, net 263. The legs and description are the same ones the helper wrote, now in the capture's own entry group and DB transaction. Lines: prod +13/-14 (capture.ts +13/-4, routes/transactions.ts +0/-10), test +147/-0 (new file `apps/api/src/payments/capture.audit.test.ts`).

**Why this is the smallest correct fix:** The discount moves to the one function that every capture path already shares, so the link path and the API path cannot diverge again, and no second implementation exists. The rejected alternatives:
- *Call the helper from `pay.ts` as well* (3 lines). That makes two post-commit paths. If the helper throws after a real charge the link stays `reserved`, the discount never lands, and the outbox and timeline still say 2,750.
- *Book the net fee on the `capture: MDR fee` legs*: fewer lines, but the legs would change meaning (gross MDR before, net after) compared with every row already in the ledger, and the discount would vanish from the audit trail.
- *Delete `discountAdjustment.ts` and its test*: more diff for no behaviour change. They are left in place to keep the diff small, now unused by any route; `discountAdjustment.test.ts` (4/4) still passes against its own seeded rows. **Follow-up:** delete `discountAdjustment.ts` and its test. Until then, never wire `applyCaptureDiscountAdjustment` back into a capture path: capture already books the discount, so it would be discounted twice.

**Proof:** `capture.audit.test.ts`, all red before the fix and green after:
- `FEES-3: a payment-link capture books the negotiated discount (fee 2,406 net, not 2,750)`. Before: fee 2750, merchant_payable 97250, 0 discount legs, outbox and timeline 2750. After: 2,406 / 97,594 / 2 legs / 2,406 / 2,406.
- `FEES-3: the merchant capture route books exactly one discount leg pair, even on a replayed capture`. Before: the ledger was right, but outbox and timeline said 2750. After: 2406, with one leg pair across a capture and its idempotent replay.
- `FEES-3: 12,345 fils at 250 bps with a 1500 bps discount books 263 via link capture and via API capture`. Before: the link path booked 309 (merchant_payable 12036). After: 263 on both paths (merchant_payable 12,082). Go `CloseBatch` gives 263 for the same vector after FEES-5.

`processRefund.audit.test.ts` (REF-7 F = ledger net), `processRefund.test.ts`, `refunds.audit.test.ts` and `discountAdjustment.test.ts`: 31/31. Full api suite: 426/426 pass. `tsc --noEmit` is clean.

**Regression risk:** A merchant with `negotiated_discount_bps = 0` gets `discountFils = 0`, so no legs are written and `feeFils` is unchanged. REF-7 refunds already read F as `platform_fee_revenue` credits − debits for the transaction, so they reverse the net fee with no change (REF-7 still 250 − 50 = 200). The webhook `feeFils` for discounted merchants now reports the net fee, which is what was charged. Historic data stays as booked: link captures already booked at the gross fee (309 in the example) are not rewritten. The ledger is append-only (LED-1), so any correction would be a compensating entry, never an edit. API-path captures from before the fix keep their separate post-commit discount group.

**Trap note:** MK's `pay.ts:113` "it's applied for both now (moved into capture.ts in July)" was false until this fix; FH's line above it is now stale. Both are left as they are (no-diff rule). The docs disagree on the formula: CHANGELOG 1.3.1 ("applied after MDR at capture and settlement") and Yousif's 0047 note ("— y: off the fee, after MDR") against `docs/ARCHITECTURE.md:55-56` ("Discounts reduce the amount the MDR is charged on") and AM's 0047 line. The user's 2026-10-30 option-A decision settles it: fee-first, booked once in the ledger, which the case file names as the place money must be right. Settlement's matching change is FEES-5.
