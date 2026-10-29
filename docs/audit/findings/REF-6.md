### REF-6 · Acquirer refund idempotency key changes on every retry · FP-300 (☐2 "money is right in the ledger") · Severity: High

**What's wrong:** The refund sent to the acquirer is keyed `${claimId}:${attemptCount}`. When a same-key retry follows a 502, the acquirer sees a brand-new request and pays it again, even if the first call went through and only the response was lost.

**Why it happens:** `apps/api/src/payments/processRefund.ts:151` (was `:149`) built the acquirer key from `attemptCount`. `claimIdempotencyKey` raises that count on every `retry_after_failure` (`idempotency.ts:156-160`). The 502 branch (`failIdempotencyKey`) marks the claim retryable because "nothing durable happened". But a transport error from the acquirer does not prove that no money moved. The faulty assumption was that the acquirer only ever sees one attempt, so a per-attempt key is harmless. The acquirer simulator dedupes refunds by `idempotencyKey` (`acquirer/simulator.ts:157-168`), so a stable key is exactly what makes a retry safe.

**What it breaks:** A refund of 5,000 fils hits an acquirer timeout after the acquirer has already paid, and the API returns 502. The client retries with the same `Idempotency-Key`. The acquirer receives `<claim>:2`, which is not in its cache, and pays another 5,000 fils. That is 10,000 fils out against 5,000 fils on our books.

**Why it needed a fix:** Retrying after a 502 is the documented contract (the claim is left retryable), and every network blip on a refund then risks a duplicate payout that is invisible in the ledger.

**Fix:** `apps/api/src/payments/processRefund.ts:151`
```diff
-    idempotencyKey: `${prepared.claimId}:${prepared.attemptCount}`,
+    idempotencyKey: prepared.claimId, // REF-6: stable across retries so the acquirer replays, never pays twice
```
Commit: this commit. Lines: prod +1/-1, test +24/-0.

**Why this is the smallest correct fix:** It is a single expression change. The claim id is already unique per (merchant, endpoint, client key) and stays the same across retries, so it is the natural stable key. The "money leaves before a durable record" half of this lead is already closed by REF-1: phase 1 now commits a reservation of `refunded_fils` before the acquirer call, so a crash in phase 3 fails closed and the reserved fils cannot be refunded again under a new key.
- Why not derive the key from the client's `Idempotency-Key`: the claim id already wraps it, scoped per merchant.
- Why not add a `pending` refunds row before the acquirer call: about 20 more lines plus a status migration, and the REF-1 reservation already gives the durable fail-closed record.
- Why not add a stale-claim sweeper: it would turn orphaned claims into retryable ones, which reintroduces the double payout.

**Proof:** The new test `REF-6: a same-key retry after an acquirer error reuses the acquirer idempotency key` uses a recording acquirer that returns `error` and then `approved`. Before the fix it failed with `expected: '<claim>:1'`, `actual: '<claim>:2'`. After the fix both calls carry the same key, the first answers 502 and the retry 200. processRefund + initiateMerchantRefund: 23 pass, 0 fail.

**Regression risk:** `acquirer/simulator.ts:156-168` caches every refund result by key, including a rolled `error`. With a stable key, a same-key retry against the built-in simulator replays the cached `error` (502 again) instead of rolling again. That is fail-safe (no double payout), but with `ACQUIRER_FAILURE_RATE > 0` the client then has to use a new key. A real acquirer does not cache a transport error. The out-of-lane patch below makes the simulator behave the same way. The existing test "an acquirer transport error answers 502 and leaves the key retryable" uses a fixed stub and still passes. Residual: a 502 releases the REF-1 reservation, so a *different*-key refund sent inside that window is not blocked. That is an unknown-outcome reconciliation case and is out of scope. Out-of-lane patch for the simulator owner: `simulator.ts:167` `refundCache.set(...)` → `if (result.outcome !== "error") refundCache.set(req.idempotencyKey, result);`.

**Trap note:** `processRefund.ts:39` ("validate, call the acquirer, then journal") and `processRefund.test.ts:392` ("a retry with the same key re-attempts") present the re-attempt as safe. They stay, because the re-attempt is now safe at the acquirer.
