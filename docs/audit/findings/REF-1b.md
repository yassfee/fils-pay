### REF-1b · A refund racing a declined refund can lock the transaction as `refunded` for good · FP-209 / H1 · Severity: High

**What's wrong:** After REF-1, a refund reserves its amount in `transactions.refunded_fils` in phase 1 and only releases it if the acquirer declines. Phase 3 of an approved refund computed the new status from `refunded_fils`, which also contains other refunds' in-flight reservations. If that other refund is then declined, its reservation is released but the status written from it is not.

**Why it happens:** `apps/api/src/payments/processRefund.ts:170-176` (before the fix) set `newRefundedTotal = refunded_fils` (comment: "already includes this refund") and passed it to `nextStatusAfterRefund`. The decline branch (`:156-158`) only subtracts the reservation; it never recomputes the status. `validateRefundRequest` (`payments/refundValidation.ts:31`) refuses any status outside the refundable set, so a `refunded` row is final.

**What it breaks:** Capture 10,000. Refund B (6,000) reserves (refunded_fils 6,000) and waits at the acquirer. Refund A (4,000) passes validation (refundable 4,000), reserves (10,000), is approved and writes status `refunded`, a `refunded` timeline event and a `refund.succeeded` webhook saying `refundedTotalFils: 10000, newStatus: refunded`. B is declined: refunded_fils goes back to 4,000. The transaction now says `refunded` with 6,000 fils captured and never refunded; every later refund of those 6,000 is 409 `transaction_not_refundable`. The merchant's customer cannot be refunded, and the webhook and timeline told the merchant it was fully refunded.

**Why it needed a fix:** FP-300 box 1 (refunds work end to end) and H1 (state and money must agree). The race is the normal shape of two partial refunds from two clients, which the public route now allows.

**Fix:** `apps/api/src/payments/processRefund.ts:170-182`
```diff
-    const cur = await client.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
-    const newRefundedTotal = toFils(Number(cur.rows[0]!.refunded_fils)); // already includes this refund (reserved in phase 1)
+    await client.query(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
+    // REF-8: ... (moved up 5 lines, unchanged)
+    const prior = await client.query<...>(`SELECT COALESCE(SUM(amount_fils), 0) ... FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`, ...);
+    const newRefundedTotal = toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount); // REF-1b: succeeded refunds + this one; refunded_fils also holds other refunds' in-flight reservations
     const newStatus = nextStatusAfterRefund({ ... refundedTotalFils: newRefundedTotal });
-    // REF-8 ... / const prior = ... (old position)
     const feeReversedFils = subtractFils(
-      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, toFils(Number(prior.rows[0]!.amount) + prepared.requestedAmount)),
+      calculateRefundFee(prepared.capturedFils, prepared.feeChargedFils, newRefundedTotal),
```
The total used for the status, the timeline event type, the webhook `refundedTotalFils` and the REF-8 fee share is now Σ succeeded refunds + this refund, read under the same row lock. Lines: prod +5/-5 (net 1 new code line: the moved REF-8 query and its comment account for 2+2), test +35/-0.

**Why this is the smallest correct fix:** The REF-8 query already reads Σ succeeded refund amounts under the lock; moving it above the status computation and reusing its sum is one changed line plus the move. *Why not recompute the status in the decline branch?* That needs a second read of Σ succeeded plus the status logic duplicated there (about 8 lines), and the approved refund's timeline event and webhook would still have said `refunded`. *Why not hold the row lock across the acquirer call?* That reverts REF-1's design (no lock across network I/O).

**Proof:** `REF-1b: an approved refund racing a declined one computes its status from succeeded refunds, not reservations` (`apps/api/src/payments/processRefund.audit.test.ts`) gates the declining acquirer so B is provably in flight while A runs. Before the fix: `'refunded' !== 'partially_refunded'`. After: status `partially_refunded`, refunded_fils 4,000, and the remaining 6,000 refunds with 200. `processRefund.test.ts` 13/13, `processRefund.audit.test.ts` 4/4, `initiateMerchantRefund.test.ts` 10/10, `routes/refunds.audit.test.ts` 7/7 (including concurrent refunds), `routes/transactions.test.ts` 10/10.

**Regression risk:** Without concurrency, Σ succeeded + this refund equals refunded_fils, so every sequential path is unchanged. A reservation leaked by a phase-2 crash (design §4.5) no longer pushes the status to `refunded`; refunds stay blocked by the amount check (refundable = captured − refunded_fils), so it still fails closed.

**Trap note:** The REF-1 note called this "only that status can lag"; it does not lag, it sticks. `docs/audit/findings/REF-1.md` is corrected.
