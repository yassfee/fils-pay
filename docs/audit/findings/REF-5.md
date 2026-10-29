### REF-5 · Status recompute turns chargebacks back into refundable captures · H7, H1, FP-300 · Severity: High
**What's wrong:** The same finance backfill rewrites every `chargeback` transaction to `captured` / `partially_refunded` / `refunded`, erasing the chargeback and making the money refundable again.

**Why it happens:** `recomputeTransactionStatusesForMerchant` (`apps/api/src/admin/transactionStatusRecompute.ts:29`) selects every row whose status is not `authorized` or `voided`, so chargebacks are included. It then sets each row to `nextStatusAfterRefund(...)` (`:38-44`), a function that only knows captured/partially_captured/partially_refunded/refunded and can never return `chargeback`. So the backfill "corrects" a chargeback into a capture.

**What it breaks:** A 10,000-fil transaction that was charged back (the acquirer already pulled the 10,000 fils back) becomes `captured`, which is in `REFUNDABLE_STATUSES` (`refundValidation.ts:18`). Once FP-300 ships, the merchant can refund it, so the cardholder is paid twice (chargeback + refund = 20,000 fils out for one 10,000-fil sale). Reports and the timeline also lose the chargeback.

**Why it needed a fix:** It is a direct double-payout path once refunds go live, and the backfill is presented to finance as safe to rerun.

**Fix:** `apps/api/src/admin/transactionStatusRecompute.ts:29`
```diff
-      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided')
+      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided', 'chargeback')
```
Lines: prod +1/−1, test +23/−0.

**Why this is the smallest correct fix:** a chargeback is a terminal state that amounts cannot recompute, so it must not be a candidate at all. One literal in the WHERE clause does that. Why not teach `nextStatusAfterRefund` about chargebacks? It is the shared refund state machine (FP-300 uses it), and widening its contract is a larger, riskier change.

**Proof:** `adminMerchantsRecompute.audit.test.ts` "recompute-statuses leaves chargeback transactions as chargeback" fails before (`expected: 'chargeback', actual: 'captured'`) and passes after; the file plus `routes/admin.test.ts`: 43/43.

**Regression risk:** chargeback rows are no longer counted in `scanned`; nothing else reads that count for chargebacks.

**Trap note:** `docs/ADMIN.md:41-43` "Safe to run more than once" and the YA "idempotent" note (`apps/admin/src/api/merchants.ts:58`): it is idempotent only because it destroys the chargeback state on the first run.
