### REF-5 · Status recompute turns chargebacks, if chargeback rows exist, back into refundable captures · H1, FP-300 · Severity: Medium
**Category:** Bug

**What's wrong:** If any `chargeback` transactions exist, the finance status backfill rewrites each one to `captured` / `partially_refunded` / `refunded`, erasing the chargeback and making the money refundable again.

**Reachability (why Medium):** `chargeback` is a legal status (`db/migrations/0004_transactions.sql:12`, `0043:15`) and the merchant dashboard lists it (`apps/web/src/types.ts:83`), but no application path writes it: no API, Go or script code sets `status = 'chargeback'`, and the seed generator has no chargeback rows. Such rows can come only from an ops import or a direct database write. The defect is real for that data, but no app flow produces it today.

**Why it happens:** `recomputeTransactionStatusesForMerchant` (`apps/api/src/admin/transactionStatusRecompute.ts:29`) selects every row whose status is not `authorized` or `voided`, so chargebacks are included. It then sets each row to `nextStatusAfterRefund(...)` (`:38-44`), a function that only knows captured/partially_captured/partially_refunded/refunded and can never return `chargeback`. So the backfill "corrects" a chargeback into a capture.

**What it breaks:** A 10,000-fil transaction that was charged back (the acquirer already pulled the 10,000 fils back) becomes `captured`, which is in `REFUNDABLE_STATUSES` (`refundValidation.ts:18`). With FP-300 refunds live, the merchant can refund it, so the cardholder is paid twice (chargeback + refund = 20,000 fils out for one 10,000-fil sale, the H1 question). Reports and the timeline also lose the chargeback.

**Why it needed a fix:** It is a direct double-payout path for any chargeback row once refunds are live, and the backfill is presented to finance as safe to rerun.

**Fix:** `apps/api/src/admin/transactionStatusRecompute.ts:29`
```diff
-      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided')
+      WHERE merchant_id = $1 AND status NOT IN ('authorized', 'voided', 'chargeback')
```
Lines: prod +1/−1, test +23/−0.

**Why this is the smallest correct fix:** a chargeback is a terminal state that amounts cannot recompute, so it must not be a candidate at all. One literal in the WHERE clause does that. Why not teach `nextStatusAfterRefund` about chargebacks? It is the shared refund state machine (FP-300 uses it), and widening its contract is a larger, riskier change.

**Proof:** `adminMerchantsRecompute.audit.test.ts` "recompute-statuses leaves chargeback transactions as chargeback" (the test inserts the chargeback row directly) fails before (`expected: 'chargeback', actual: 'captured'`) and passes after; the file plus `routes/admin.test.ts`: 43/43.

**Regression risk:** chargeback rows are no longer counted in `scanned`; nothing else reads that count for chargebacks.

**Trap note:** `docs/ADMIN.md:41-43` "Safe to run more than once" and the YA "idempotent" note (`apps/admin/src/api/merchants.ts:58`): it is idempotent only because it destroys the chargeback state on the first run.
