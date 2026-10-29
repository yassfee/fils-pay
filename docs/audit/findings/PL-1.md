### PL-1 · A slow payment lets a second buyer re-claim the link and both are charged · INCIDENT 2026-05-14 · Severity: Critical

**What's wrong:** The public pay flow reserves a link with a committed 60 s lease that records no holder, then runs authorize+capture with no lock held. A second buyer who arrives after the lease has gone stale re-claims the link and is charged too. Finalize was not fenced to the first holder.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts:65-76`: the claim `UPDATE ... SET status='reserved', reserved_at=now()` commits on its own (`pool.query`), so the row lock is released at once. The `OR (status = 'reserved' AND reserved_at < now() - timeout)` branch (`:71`) lets anyone take over a lease older than the timeout, even while the first request is still inside `captureTransaction`. Finalize (`:144-148`, `WHERE id = $1 AND status = 'reserved'`) matches whoever's reservation is current. The loser falls into the 0-row branch, which logs and still answers 200 after its card was captured. The faulty assumption was that authorize+capture always finishes inside the lease. Several comments hid this. The JSDoc (`:46-52`) called "release the row lock immediately ... no lock held" the design. `:137` "MK: re-evaluation is exactly what makes it safe. the bug was in the web retry, closed". `:152` "MK: authorize+capture is under a second. 60s can't happen. unreachable", which answered FH's correct note above it.

**What it breaks:** A 4,750 fils link: buyer A's payment takes longer than the lease, buyer B re-claims and pays, and both get 200. 9,500 fils is captured for one 4,750 fils sale, and one buyer has to chase a refund. This is the 2026-05-14 incident.

**Why it needed a fix:** Acquirer latency spikes (3DS, issuer timeouts) routinely exceed short leases. Every spike can double-charge a customer.

**Fix:** `apps/api/src/paymentLinks/pay.ts`: the existing body re-enters itself once inside `withTransaction`, and the claim, both releases and finalize use that transaction's client. The claim's row lock is therefore held through authorize+capture until finalize commits.
```diff
-import type { Pool } from "pg";
+import type { Pool, PoolClient } from "pg";
+import { withTransaction } from "../db/withTransaction.js";
   input: PayPaymentLinkInput,
+  client?: PoolClient,
 ): Promise<PayPaymentLinkResult> {
+  // PL-1: re-enter inside one transaction so the claim's row lock is held until finalize.
+  if (!client) return withTransaction(pool, (c) => payPaymentLink(pool, acquirer, config, input, c));
-  const claimResult = await pool.query<ClaimedLinkRow>(
+  const claimResult = await client.query<ClaimedLinkRow>(
-    await releaseReservation(pool, link.id);   (x2)
+    await releaseReservation(client, link.id); (x2)
-  const finalizeResult = await pool.query<{
+  const finalizeResult = await client.query<{
-async function releaseReservation(pool: Pool, linkId: string)
+async function releaseReservation(pool: Pool | PoolClient, linkId: string)
```
The comments that hid the bug are corrected: JSDoc 7 lines become 3, and the `:136-138` and `:151-153` FH/MK/am notes become one accurate line each. Commit: this commit. Lines: prod +15/-19 (code +9/-6, comments +6/-13), test +40/-0.

**Why this is the smallest correct fix:** It uses the same discipline `capture.ts` already relies on (a row lock held across the acquirer call), applied with nine changed code lines and no re-indentation. A concurrent claim UPDATE now blocks on the row. After the holder commits it re-evaluates against `status='paid'`, gets 0 rows, and answers 409 `payment_link_already_paid`. After a decline, the holder resets the link to `active` in the same transaction and the waiter proceeds. A crash drops the connection, Postgres rolls back, and the link is simply `active` again with nothing to steal.
- Why not the dossier's full rewrite (explicit connect/BEGIN, `FOR UPDATE NOWAIT`, 55P03 mapped to 409, try/catch/finally): it is correct but about 30 or more changed lines.
- Why not fence finalize with a holder token (`AND reserved_at = $claimed`): that only detects the loser after its capture, so money has already moved twice and a refund flow is needed. It does not prevent the incident.
- Why not just raise the timeout: it only shrinks the window.

**Proof:** The new test `PL-1: a slow payment past the reservation timeout cannot be paid twice` (`routes/paymentLinks.test.ts`) uses acquirer latency 1,500 ms and a 1 s lease, with a second pay sent at 1,200 ms. It failed before the fix with `actual: [200, 200]`, expected `[200, 409]`. After the fix it passes, with exactly one captured transaction. routes/paymentLinks + paymentLinks/pay + status: 22 pass, 0 fail, including the existing reservation-timeout replay test.

**Regression risk:** One payment now holds two pool connections (the link lock, and authorize/capture's own transaction), as capture does. A concurrent second buyer waits for the first instead of getting an instant 409 `payment_link_processing`. Public reads show `active` (not `reserved`) during a payment, because the reservation is never committed. authorize/capture never touch `payment_links` (only migrations 0020/0029 reference it), so there is no self-deadlock.

**Trap note:** The JSDoc design claim and the `MK:` "re-evaluation is exactly what makes it safe" / "60s can't happen. unreachable" notes are replaced with accurate one-liners citing the incident.
