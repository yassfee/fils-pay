### REF-8 · Partial refunds round the fee reversal per partial, so they can reverse more fee than was charged · H1 · Severity: Medium

**What's wrong:** Each partial refund reverses `round(F × r / C)` on its own. The rounding errors of the partials add up, so a series of partials that refunds the whole capture can reverse more (or less) than the fee F that was charged.

**Why it happens:** `apps/api/src/payments/processRefund.ts:177-181` (before the fix) called `calculateRefundFee(capturedFils, feeChargedFils, requestedAmount)` with only this refund's amount. Nothing looked at what earlier refunds of the same transaction had already reversed. `calculateRefundFee` (`packages/money/src/fils.ts:260-273`) is correct for one share; the bug is the per-partial call.

**What it breaks:** Design FP-300 §5 worked example: C = 10,000, F = 275 (275 bps, no discount). Refunds 3,333 + 3,333 + 3,334 reverse 92 + 92 + 92 = 276 (91.6575 and 91.685 both round up). After the full refund `platform_fee_revenue` for the transaction is −1 and `merchant_payable` is +1: the merchant is paid one fil of fee that was never charged. The error grows with the number of partials.

**Why it needed a fix:** H1 / case file "ledger right to the fil": a fully refunded transaction must net to 0 on every account.

**Fix:** `apps/api/src/payments/processRefund.ts:177-182`
```diff
-    const feeReversedFils = calculateRefundFee(
-      prepared.capturedFils,
-      prepared.feeChargedFils,
-      prepared.requestedAmount,
+    // REF-8: round cumulatively (share of F for all succeeded refunds incl. this one, minus what was already reversed), so partials sum to exactly F.
+    const prior = await client.query<{ amount: string; fee: string }>(`SELECT COALESCE(SUM(amount_fils), 0)::text AS amount, COALESCE(SUM(fee_reversed_fils), 0)::text AS fee FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`, [prepared.transactionId]);
+    const feeReversedFils = subtractFils(
+      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount)),
+      toFils(Number(prior.rows[0]!.fee)),
     );
```
f_k = calculateRefundFee(C, F, R_k) − Σ_{j<k} f_j, where R_k = Σ succeeded refund amounts + this refund. The partials telescope, so at R = C they sum to exactly `calculateRefundFee(C, F, C) = F`. Lines: prod +5/-4 (1 comment, 4 code), test +25/-0.

**Why this is the smallest correct fix:** One query and one changed expression, inside phase 3, after the existing `SELECT refunded_fils … FOR UPDATE` row lock (`:170`), so concurrent refunds of the same transaction read the prior sums serially. *Why R_k from `refunds` and not `transactions.refunded_fils`?* `refunded_fils` already includes other refunds' in-flight reservations (REF-1 reserves in phase 1). If one of those is later declined and released, the share would have been computed on an amount that was never refunded, and a following smaller refund could get a negative `f` (refused by `CHECK (fee_reversed_fils >= 0)`). Σ succeeded refunds + r is the "refunded total including this refund" the design means. *Why not change `calculateRefundFee`?* It is a correct pure function used by its own tests; the cumulative state lives in the DB, not in the money package. *Why not largest-remainder allocation?* Future partial amounts are unknown when a partial is made.

**Proof:** `REF-8: partial refunds round cumulatively, so their fee reversals sum to exactly the fee charged` (`apps/api/src/payments/processRefund.audit.test.ts`) fails before the fix (`[92, 92, 92]` vs `[92, 91, 92]`) and passes after; it also asserts `platform_fee_revenue`, `merchant_payable` and `card_scheme_clearing` net to 0. REF-7 test, `processRefund.test.ts` (13/13) and `initiateMerchantRefund.test.ts` (10/10) pass.

**Regression risk:** A single (full or first) refund has prior sums 0, so its value is unchanged. `calculateRefundFee` is monotonic in the refund amount and the prior fee equals the share of the prior amount, so f_k ≥ 0 always.

**Trap note:** None in code; the per-partial rounding looks correct in isolation, which is why the existing single-refund tests never caught it.
