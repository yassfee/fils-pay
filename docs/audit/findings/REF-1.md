### REF-1 · Concurrent refunds both pay out (unlocked check, acquirer outside the txn, absolute write) · FP-209 · Severity: Critical

**What's wrong:** Two refund requests for the same transaction with different idempotency keys can both pass validation, both call the acquirer, and both succeed. Together they return more than was captured.

**Why it happens:** In `apps/api/src/payments/processRefund.ts`, phase 1 (`:73-78`) read `refunded_fils` with no row lock and committed. Phase 2 (`:146`) called the acquirer outside any transaction. Phase 3 (`:165`, `:199-203`) wrote an absolute total, `SET refunded_fils = $2`, which was `prepared.refundedFils + requested` from that stale read. Nothing held the refundable amount between the check and the payout. `capture.ts` does not have this problem because it keeps a `SELECT ... FOR UPDATE` lock for the whole operation. The faulty assumption was that the idempotency claim serializes refunds. It only blocks the same key. A test comment hid this (`processRefund.test.ts:257`): "should there be a test for two refunds at the SAME time? nvm the claim blocks it".

**What it breaks:** Capture 10,000 fils, then send two 10,000 fils refunds at the same time. Before the fix both returned 200, the acquirer paid twice (20,000 fils out on a 10,000 fils charge), and two `refunds` rows were written. Because of the lost update, `refunded_fils` read 10,000, so the books hid the extra 10,000 fils. This is FP-209: "Both went through, and we lost money."

**Why it needed a fix:** A double-click, a client retry with a new key, or a deliberate burst pays the refund out several times. The ledger also stops showing the loss.

**Fix:** `apps/api/src/payments/processRefund.ts`
```diff
-        WHERE id = $1`,
+        WHERE id = $1 FOR UPDATE`,
@@ after the validation 422/409 return (phase 1)
+    // REF-1 (FP-209): reserve under the row lock before any money moves; released below if not approved.
+    await client.query(`UPDATE transactions SET refunded_fils = refunded_fils + $2 WHERE id = $1`, [txn.id, validation.amountFils]);
@@ phase 3, first statement
+    if (acquirerResult.outcome !== "approved") {
+      await client.query(`UPDATE transactions SET refunded_fils = refunded_fils - $2 WHERE id = $1`, [prepared.transactionId, prepared.requestedAmount]);
+    }
@@ phase 3 success
-    const newRefundedTotal = addFils(prepared.refundedFils, prepared.requestedAmount);
+    const cur = await client.query<{ refunded_fils: string }>(`SELECT refunded_fils FROM transactions WHERE id = $1 FOR UPDATE`, [prepared.transactionId]);
+    const newRefundedTotal = toFils(Number(cur.rows[0]!.refunded_fils)); // already includes this refund (reserved in phase 1)
-    await client.query(`UPDATE transactions SET refunded_fils = $2, status = $3 WHERE id = $1`, [ ...4 lines ]);
+    await client.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [prepared.transactionId, newStatus]);
```
Plus `addFils` dropped from the import because it is no longer used. Commit: this commit. Lines: prod +10/-8, test +43/-1 (new test +42; the misleading `am:` comment rewritten +1/-1).

**Why this is the smallest correct fix:** The amount is reserved in phase 1 under a `FOR UPDATE` lock, so the existing validator decides on the latest committed total. A second request blocks on the lock, then sees `refunded_fils = 10,000` and gets the existing 422 `refund_exceeds_refundable` with the right `refundableFils`. No new error path is needed. Phase 3 never writes an absolute total again, and it re-reads the total under the lock to set the status.
- Why not the dossier's conditional `UPDATE ... WHERE refunded_fils + $x <= captured_fils` with its own 422 branch: that adds about 4 more lines and duplicates the validator's error body.
- Why not hold one transaction across the acquirer call, as `capture.ts` does: that is a restructure. A crash mid-call would also roll back the claim, so a same-key retry could pay again. The reservation fails closed instead: if phase 3 crashes after an approval, the fils stay reserved.
- Why not a `CHECK (refunded_fils <= captured_fils)` migration: it is defence in depth and does not stop the double payout, because the acquirer is called before any write.
- Release on `error` (502) as well as `declined` (402): this keeps the existing contract that a 502 is retryable with no side effect (covered by the "acquirer transport error ... retryable" test).

**Proof:** The new test `REF-1: two concurrent refunds whose sum exceeds the capture pay out exactly once` runs a barrier acquirer that waits for the second call or 300 ms. Before the fix it failed with `actual: [200, 200]`, expected `[200, 422]`. After the fix it passes: one acquirer call, one `refunds` row, `refunded_fils` 10,000, status `refunded`. processRefund + initiateMerchantRefund + refundValidation + refundState: 37 pass, 0 fail.

**Regression risk:** The sequential paths (full, partial, two partials, replay, 402 decline, 502 then retry, voided, outbox) are all still green. Residual edge (corrected, see REF-1b): if two partial refunds run at once and one is declined, the approved one computed its status from a total that still included the other's reservation. The status did not merely lag: it could be written as `refunded` and never revert, so the rest of the capture became permanently non-refundable (`refundValidation.ts:31`). Money and `refunded_fils` stayed correct. Fixed in REF-1b.

**Trap note:** `processRefund.test.ts:257` ("nvm the claim blocks it") is rewritten to say the claim blocks only the same key. The REF-1 test now covers different keys.
