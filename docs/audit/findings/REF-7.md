### REF-7 · A refund reverses the gross MDR fee, ignoring the negotiated-discount rebate · H1 · Severity: High

**What's wrong:** `processRefund` takes "the fee actually charged" as the sum of `platform_fee_revenue` **credits** for the transaction. For a merchant with `negotiated_discount_bps > 0`, capture is followed by a rebate leg that **debits** `platform_fee_revenue` (`capture: negotiated discount adjustment`). The refund ignores that debit, so it hands back more fee than FilsPay kept.

**Why it happens:** `apps/api/src/payments/processRefund.ts:115-121` (before the fix) filtered `direction = 'credit'`. The rebate is written by `apps/api/src/payments/discountAdjustment.ts:81` as a `platform_fee_revenue` debit with the same `transaction_id`. Yousif's note in `routes/refunds.ts:20-21` says the helpers were written before the discount and tier existed.

**What it breaks:** Merchant at 250 bps with a 2,000 bps negotiated discount captures 10,000 fils: fee 250, rebate 50, so F = 200 and `platform_fee_revenue` nets +200. A full refund reverses 250: `platform_fee_revenue` ends at −50 and `merchant_payable` at +50 for a transaction that no longer exists. Each fully refunded discounted transaction pays the merchant 50 fils of fee that was never charged (and partials leak proportionally).

**Why it needed a fix:** H1 / case-file "ledger right to the fil" and "fees right": after a full refund every account for the transaction must net to 0. FP-300 wires this helper to a public route, so the leak would go live.

**Fix:** `apps/api/src/payments/processRefund.ts:116,120`
```diff
-      `SELECT COALESCE(SUM(amount_fils), 0)::text AS fee_fils
+      `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS fee_fils
          FROM ledger_entries
         WHERE transaction_id = $1
           AND account_id = 'platform_fee_revenue'
-          AND direction = 'credit'`,
+          AND COALESCE(description, '') NOT LIKE 'refund:%'`,
```
F = Σ credits − Σ debits on `platform_fee_revenue` for the transaction, excluding the refund's own `refund:%` legs (so F is the same for every partial). `description` is nullable, hence the `COALESCE`. Lines: prod +2/-2, test +107/-0 (new file `apps/api/src/payments/processRefund.audit.test.ts`, shared with REF-8 and the CHECK guard).

**Why this is the smallest correct fix:** Two lines in the one query that defines F. *Why not recompute F from mdr_bps, tier and discount?* That re-derives a historical fee from today's settings (the original comment at :111-114 rightly forbids it). *Why not read `transaction_events.metadata.feeFils`?* That is the pre-discount fee, the same bug. *Why exclude `refund:%` rather than filter on capture descriptions?* Any future capture-side fee leg is then included automatically; only the reversals this function writes are excluded.

**Proof:** `REF-7: a full refund reverses the fee actually charged, net of the negotiated discount` fails before the fix at `feeReversedFils` (`250 !== 200`) and passes after; it also asserts `platform_fee_revenue`, `merchant_payable` and `card_scheme_clearing` net to 0 for the transaction. `processRefund.test.ts` (13/13) and `initiateMerchantRefund.test.ts` (10/10) still pass.

**Regression risk:** No discount → no debit leg → F unchanged. `admin/credits.ts` MDR reversals have no `transaction_id`, so they are not counted.

**Trap note:** The comment at `processRefund.ts:111-114` claims F is "the fee this transaction was actually charged"; it was only the gross fee. The design's FEES-3 question (capture books MDR − tier, Go settlement charges MDR on the discounted amount) is separate and unaffected: refunds reverse what the ledger charged.
