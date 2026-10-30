### IDEM-1 · Capture idempotency hash omits the transaction id, so a reused key on another transaction replays a fake success · FP-300 (☐2 "money is right in the ledger") · Severity: High
**Category:** Bug

**What's wrong:** A capture idempotency key is scoped to (merchant, endpoint, key), and its request hash covers only `amountFils`. Reusing a key on a *different* transaction with the same body is therefore treated as a replay: the second transaction gets the first one's 200 body and is never captured.

**Why it happens:** `apps/api/src/payments/capture.ts:92` hashed `{ amountFils }` only. `claimIdempotencyKey` (`idempotency.ts:118-153`) finds the completed row for the same (merchant, `transactions.capture`, key), sees an equal hash, and returns `replay`. The transaction id is in the URL path, not the body, so it never reached the hash. The faulty assumption was that keys are per transaction. A test comment hid this (`routes/transactions.test.ts:218-219`): "FH: should also cover same key + same body on a DIFFERENT transaction -> 422 ... Claude says that case can't happen because keys are per transaction". (That comment cites an `API.md`; no such file exists in the repo, so we do not rely on it.)

**What it breaks:** A client derives its key from the order (`capture-order-1042`) and the order is re-authorized. Txn A (5,000 fils) is captured. Txn B (8,000 fils) then gets 200 with A's body but stays `authorized`, with 0 fils captured. Goods ship, the hold lapses, and 8,000 fils is never collected. The replay also re-triggers the route's discount adjustment path for B.

**Why it needed a fix:** The API answers "captured" for money it never captured. That is silent revenue loss. It also breaks the contract written next to the idempotency table: the FH comment at `db/migrations/0019_idempotency_keys.sql:32-33` says "for capture, request_hash covers the transaction id as well as the body, so reusing a key on a different transaction is a 422". That comment describes the intended behaviour as if it were done, and the code never did it. `capture.ts:104` already maps a hash mismatch to 422 `idempotency_key_reused`; the transaction id just never reached the hash.

**Fix:** `apps/api/src/payments/capture.ts:92`
```diff
-  const requestHash = hashRequest({ amountFils: input.amountFils ?? null });
+  const requestHash = hashRequest({ transactionId: input.transactionId, amountFils: input.amountFils ?? null });
```
Commit: this commit. Lines: prod +1/-1, test +16/-2.

**Why this is the smallest correct fix:** One field is added to the hash input, the same pattern `processRefund.ts:45-49` already uses (it hashes `transactionId`). A cross-transaction reuse then falls into the existing `conflict_hash_mismatch` → 422 `idempotency_key_reused` path.
- Why not put the transaction id into the key scope (`endpoint` or `key`): that changes the claim schema and semantics for every endpoint.
- Why not reject in the route: the path id is not visible at the claim, so that would need more code.

**Proof:** The new test `IDEM-1: reusing a capture key on a different transaction is 422 and leaves it authorized` (`routes/transactions.test.ts`) failed before the fix with `expected: 422`, `actual: 200`. After the fix it passes, and t2 stays `authorized`. routes/transactions + idempotency + discountAdjustment + routes/paymentLinks (whose pay flow captures through this function): 34 pass, 0 fail.

**Regression risk:** A same-key retry on the *same* transaction still replays, because the hash is the same (covered by the existing replay test). Capture keys completed before deploy hash without `transactionId`, so a retry of such a key returns 422 once. That is acceptable and fail-safe.

**Trap note:** The FH/"Claude says that case can't happen" comment at `routes/transactions.test.ts:218-219` is replaced by the test it asked for.
