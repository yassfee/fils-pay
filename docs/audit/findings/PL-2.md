### PL-2 · Public pay route checks expiry against the client-supplied submittedAt · FP-187 · Severity: High

**What's wrong:** `POST /v1/payment-links/:token/pay` is public and unauthenticated, yet it judges link expiry against `submittedAt` from the request body. Any buyer can pay an expired link by sending a past timestamp.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:34-38` (`expiryReferenceTime`) returned the parsed `submittedAt` whenever it was a valid date. `:60` passes that value as `$3` into the claim's `expires_at > $3` (`:73`) and into `classifyClaimFailure`. The route (`routes/paymentLinks.ts:158,167`) forwards `submittedAt` from the body with no authentication gate. The faulty assumption was that this is an "offline-terminal" feature for trusted callers. Three places hid the bug. The route's JSDoc (`routes/paymentLinks.ts:35-37`) said submittedAt is "ignored unless the request is authenticated with an API key", but no such gate exists. `pay.test.ts:21-25` ("FH: this one is the offline-terminal contract test. MK said don't delete") asserted that a client timestamp round-trips exactly. `routes/paymentLinks.test.ts:204` stated as intended that "with a past submittedAt it pays".

**What it breaks:** A 4,750 fils link expires at 12:00. At 12:30 the checkout page shows "expired", but a request with `submittedAt: "11:30"` is claimed, authorized and captured: 200, and 4,750 fils is charged on a link the merchant considers dead. This is FP-187: "the link showed 'expired', but the payment still went through. The checkout page sends something that the server shouldn't trust."

**Why it needed a fix:** Expiry is the merchant's only control over stale quotes, prices and inventory. A client-controlled clock makes it meaningless.

**Fix:** `apps/api/src/paymentLinks/pay.ts:32-38`
```diff
-/** A pay request is judged against when the buyer pressed pay, so a
- * retry that lands after midnight is not penalised. */
-export function expiryReferenceTime(submittedAt?: string): Date {
-  if (!submittedAt) return new Date();
-  const parsed = new Date(submittedAt);
-  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
-}
+/** Expiry is judged on the server's clock only: submittedAt is client-supplied and untrusted (FP-187). */
+export function expiryReferenceTime(_submittedAt?: string): Date {
+  return new Date();
+}
```
The JSDoc at `routes/paymentLinks.ts:35-37` is corrected to say submittedAt is never trusted. Commit: this commit. Lines: prod +5/-9 (code +2/-4, comments +3/-5), test +21/-5.

**Why this is the smallest correct fix:** It is fixed at the one function that decides the reference time, so the claim and the error classifier both switch to server time and no call sites change. The body field is still accepted, so existing clients do not get 400s.
- Why not just set `pay.ts:60` to `const expiryCheckTime = new Date()`: one line fewer, but `expiryReferenceTime` and its "round-trips exactly" test would remain as dead code that documents the bug as a contract.
- Why not gate submittedAt on API-key auth, as the doc claimed: the route is public by design, no such caller exists, and it would be new code.
- Why not reject requests that carry submittedAt: that breaks clients for no safety gain.

**Proof:** The new test `PL-2: an expired link stays expired when the body carries a past submittedAt` (`routes/paymentLinks.test.ts`) failed before the fix with `expected: 410`, `actual: 200` (the link was paid). The corrected unit test `expiryReferenceTime: a client-supplied ISO-8601 time is ignored -> the server's own clock` (`pay.test.ts`) also failed before. Both pass after. routes/paymentLinks + pay + status: 21 pass, 0 fail.

**Regression risk:** Requests without submittedAt already used the server clock, so they are unchanged. The existing expired/canceled/paid link tests pass.

**Trap note:** The "offline-terminal contract" test (`pay.test.ts:21-25`) encoded the bug and now asserts the opposite, citing FP-187. The "terminal case" comment (`routes/paymentLinks.test.ts:204`) is removed. The false "ignored unless ... API key" JSDoc is corrected.
