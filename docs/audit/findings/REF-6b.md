### REF-6b · Acquirer simulator caches transport errors, so a same-key refund retry can never succeed · FP-209, FP-300 (☐1) · Severity: Medium
**What's wrong:** The in-process acquirer's refund idempotency cache stores every outcome, including `error`. After REF-6 made the refund's acquirer key stable across retries (correctly), a refund that hit a transient transport error replays that cached `error` (502) on every retry and can never complete.

**Why it happens:** `apps/api/src/acquirer/simulator.ts:167` did `refundCache.set(req.idempotencyKey, result)` for any outcome. An `error` means the outcome is unknown (the request may not have reached the acquirer), so it must not be pinned. `approved` and `declined` are final answers and are correctly cached.

**What it breaks:** 2% of refunds roll a failure by default (`ACQUIRER_FAILURE_RATE=0.02`) and 30% of those are `error`: the merchant retries with the same Idempotency-Key, as designed, and gets 502 forever, while the phase-1 reservation stays held (fail closed). No money is lost, but the refund is stuck.

**Why it needed a fix:** without it REF-6's correct stable key turns every transient fault into a permanently stuck refund.

**Fix:** `apps/api/src/acquirer/simulator.ts:167`
```diff
-      refundCache.set(req.idempotencyKey, result);
+      if (result.outcome !== "error") refundCache.set(req.idempotencyKey, result); // unknown outcome: let a same-key retry ask again
```
Lines: prod +1/−1, test +21/−0.

**Why this is the smallest correct fix:** one condition at the cache write. Why not drop the stable key (undo REF-6)? That reopens the double-payout on retries.

**Proof:** `simulator.audit.test.ts` "a refund that errored is really retried under the same idempotency key" fails before (`expected: 'approved', actual: 'error'`) and passes after; simulator 7/7, processRefund 13/13.

**Regression risk:** capture and authorize caches still store `error` (same pattern); they are not retried with a stable key today, so they are left as they are and noted here.

**Trap note:** the cache comment ("a client retry after a timeout gets a consistent acquirer response") is right for final outcomes and wrong for `error`.
