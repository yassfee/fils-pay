### CAP-EXP-1 · An authorization whose 7-day hold has expired can still be captured · · Severity: Medium

**Lead:** Team 45 heads-up list (P3), verified by us.

**What's wrong:** `captureTransaction` only checks the transaction's status (`authorized` or `partially_captured`). It never looks at the authorization hold, so a merchant can capture an authorization long after its 7-day card-not-present hold lapsed and the buyer's funds were released, including after the nightly janitor marked the hold `expired`.

**Why it happens:** `apps/api/src/payments/authorize.ts:113-117` places the hold with `expires_at = now() + interval '7 days'` ("7 days = scheme rule for CNP"), and `scripts/expire_holds.ts:18-24` flips lapsed holds to `expired`. But `apps/api/src/payments/capture.ts:133-138` validates `txn.status` alone, and nothing on the transaction row changes when its hold expires, so the transaction stays `authorized` and capturable forever.

**What it breaks:** A 10.000 BD authorization from 2026-10-01 has its hold expire on 2026-10-08 and the buyer's bank releases the funds. On 2026-10-29 the merchant presses capture: the API answers 200, journals 10,000 fils to `merchant_payable` minus the fee, and the settlement batch pays it out, although the authorization it relies on is dead (a scheme violation and a near-certain chargeback). Reproduced by the test below: both a hold past `expires_at` and a hold marked `expired` captured with 200.

**Why it needed a fix:** The hold is the platform's record that the authorization is still valid; capturing past it moves money the scheme no longer guarantees, and the ledger and payout then carry funds that will be clawed back.

**Fix:** `apps/api/src/payments/capture.ts:140-146`
```diff
+    // CAP-EXP-1: a lapsed 7-day hold means a dead authorization; no hold row at all (old history) is not checked.
+    const lapsed = await client.query(`SELECT 1 FROM holds WHERE transaction_id = $1 AND (status = 'expired' OR (status = 'active' AND expires_at <= now()))`, [txn.id]);
+    if (lapsed.rows.length > 0) {
+      const body = { error: "authorization_expired" };
+      await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body });
+      return { statusCode: 409, body };
+    }
```
The check runs inside the existing transaction, after the row lock and the status check and before the acquirer call, and answers exactly like the neighbouring `not_capturable` branch (409, response stored on the idempotency key). It refuses only when the transaction's hold exists and has lapsed: marked `expired`, or still `active` past `expires_at` because the janitor has not run yet.

**Why this is the smallest correct fix:** one query and one early return at the single point every capture path goes through (merchant route, payment-link checkout). *Why not require an active hold?* HOLD-1's janitor deleted holds before it was fixed, and seeded transactions may have none; requiring a hold would make those uncapturable. A missing hold is therefore not treated as expired. *Why not rely on the janitor's `expired` status only?* It runs nightly; between `expires_at` and the next run the authorization is already dead. *Why not also flip the transaction to a new status?* There is no such status in the schema (`transactions.status` CHECK) and it would need a migration and UI changes.

**Proof:** `CAP-EXP-1: capturing an authorization whose hold has expired is refused with 409 authorization_expired` (`apps/api/src/payments/capture.audit.test.ts`). Before the fix: `expected: 409, actual: 200`. After: both lapsed variants get 409 `authorization_expired`, the transaction stays `authorized` with `captured_fils = 0`, no ledger leg is written, while a transaction with no hold row and one with a live hold still capture (200). Capture and transaction route tests pass (16/16).

**Regression risk:** Partial captures keep their hold `active` until fully captured (`capture.ts:250-253`), so a second partial capture after day 7 is now refused too, which is the same expired authorization. Seeded or demo transactions whose holds lapsed can no longer be captured; that is the intended rule. Responses for every other case are unchanged.

Lines: prod +7/-0 (1 comment line), test +31/-0
