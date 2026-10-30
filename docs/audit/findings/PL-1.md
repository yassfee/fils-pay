### PL-1 · A slow payment lets a second buyer re-claim the link and both are charged · INCIDENT 2026-05-14 · Severity: Critical
**Category:** Bug

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
The comments that hid the bug are corrected: JSDoc 7 lines become 3, and the `:136-138` and `:151-153` FH/MK/am notes become one accurate line each. Commit `104c871` (first version, superseded by PL-1b): prod +15/-19 (code +9/-6, comments +6/-13), test +40/-0.

**Why this is the smallest correct fix:** It uses the same discipline `capture.ts` already relies on (a row lock held across the acquirer call), applied with nine changed code lines and no re-indentation. A concurrent claim UPDATE now blocks on the row. After the holder commits it re-evaluates against `status='paid'`, gets 0 rows, and answers 409 `payment_link_already_paid`. After a decline, the holder resets the link to `active` in the same transaction and the waiter proceeds. A crash drops the connection, Postgres rolls back, and the link is simply `active` again with nothing to steal.
- Why not the dossier's full rewrite (explicit connect/BEGIN, `FOR UPDATE NOWAIT`, 55P03 mapped to 409, try/catch/finally): it is correct but about 30 or more changed lines.
- Why not fence finalize with a holder token (`AND reserved_at = $claimed`): that only detects the loser after its capture, so money has already moved twice and a refund flow is needed. It does not prevent the incident.
- Why not just raise the timeout: it only shrinks the window.

**Proof:** The new test `PL-1: a slow payment past the reservation timeout cannot be paid twice` (`routes/paymentLinks.test.ts`) uses acquirer latency 1,500 ms and a 1 s lease, with a second pay sent at 1,200 ms. It failed before the fix with `actual: [200, 200]`, expected `[200, 409]`. After the fix it passes, with exactly one captured transaction. routes/paymentLinks + paymentLinks/pay + status: 22 pass, 0 fail, including the existing reservation-timeout replay test.

**Regression risk (first version, superseded by PL-1b below):** One payment held two pool connections (the link lock, and authorize/capture's own transaction). The claim that this is "as capture does" was wrong: capture holds one. A concurrent second buyer waits for the first instead of getting an instant 409 `payment_link_processing`. Public reads show `active` (not `reserved`) during a payment, because the reservation is never committed. authorize/capture never touch `payment_links` (only migrations 0020/0029 reference it), so there is no self-deadlock.

**Trap note:** The JSDoc design claim and the `MK:` "re-evaluation is exactly what makes it safe" / "60s can't happen. unreachable" notes are replaced with accurate one-liners citing the incident.

**PL-1b follow-up (adversarial review): the held-lock version starved the connection pool; replaced by a fenced lease.**
The version above kept the link's row lock on one pool connection while `authorizeTransaction` and
`captureTransaction` each took a second (`authorize.ts:57`, `capture.ts:94`). With `PG_POOL_MAX=5` (the default), five
concurrent payments on five different links each held one connection and waited for another: all five failed with
500 after the 3 s connect timeout (reviewer probe). That is an outage under trivial load, worse than the bug.
**Final fix (net vs. the original `pay.ts`: prod +10/−5, of which 4 lines are comments):** the claim returns its
`reserved_at` as an exact fencing token (as text: a JS `Date` would drop the microseconds). Right **before capture**, one
conditional `UPDATE ... SET reserved_at = now() WHERE id = $1 AND status = 'reserved' AND reserved_at::text = $token`
renews the lease only if this request still holds it; if a slow payment's lease expired and another buyer re-claimed
the link, it stops with 409 `payment_link_processing` before charging the card. Finalize is keyed on the renewed token,
so only the current holder can mark the link paid. One connection at a time, like the original.
**Why this, not something smaller:** a check only in finalize's WHERE (the advisor's first idea) detects the second
charge after the money has moved; the fence must sit before capture. **Why not keep the lock and pass the client into
authorize/capture:** they open their own transactions (`withTransaction(pool)`), so nesting would commit the outer
transaction early or need SAVEPOINT plumbing.
**Residual:** the stale request is left with an authorized, uncaptured transaction and its 7-day hold (the PL-5 lead).
A second charge would need the capture call alone to exceed the reservation timeout (60 s) after the fence renewed it.
The root of that window is that the capture and the link's `paid` mark were still two separate commits, guarded only by
the lease. PL-1c below is the same window reached by a crash instead of a slow call.
**Proof:** "PL-1: a slow payment past the reservation timeout cannot be paid twice" still passes ([200, 409], one
capture). New: "PL-1: as many concurrent link payments as the pool size all succeed" (5 links, pool max 5): all 200;
the reviewer's probe on the held-lock version gave 500 ×5. Payment-link suites 22/22, `tsc` clean.
**Trap note:** `pay.ts:59-61` "YA: one conditional UPDATE = atomic claim, no explicit txn needed. correct" (true for the
claim, false for the lease, now annotated) and "MK: ... 60s can't happen. unreachable" (corrected; FH's note above it was right).

**Follow-up PL-1c, formerly CAP-6 (ours, merged into this row): a crash between the capture commit and "link paid" left captured money on a link that could be paid again.** Same root cause and incident as PL-1: `captureTransaction` COMMITs on its own (`payments/capture.ts:95`, `withTransaction`), and only afterwards did `pay.ts` mark the link `paid` with a separate `pool.query`. If the API died in between, the link stayed `reserved` with its money captured; after the 60 s lease the stale-lease branch of the claim let anyone re-reserve it, and a buyer who reloaded (new Idempotency-Key) was charged again, with the first capture linked to nothing. The PL-1b fence protects only a holder whose lease is alive, so it cannot see this.
*How we found it (kill -9):* the judged overload test says the system "restarts itself and recovers without losing data". One `kill -9` of the API in the middle of a 60-user checkout load test (`lt-20261030140945`, before the fix) left 3 transactions `captured` whose link was not `paid` (`captured_link_unpaid` = 3 in `ops/loadtest-check.sql`), with ledger legs and outbox events, plus 27 links stuck `reserved`. Each of those 3 links was payable again after 60 s. The client saw only a network error and the public link still read `reserved`, so nothing on the API showed that money had moved. An OOM kill or a restart under load does the same.
*Fix* (`4d2527c`): `captureTransaction` takes an optional `onCaptured(client)` hook that runs inside its transaction just before the idempotency key is completed (`capture.ts:57`, `:272`); `pay.ts:131-134` passes a hook that runs the same fenced `UPDATE payment_links SET status = 'paid' ... AND reserved_at::text = $lease`, and throws 409 `payment_link_processing` if the lease was lost, so the capture's ledger rows and the link's `paid` mark commit together or not at all. The stand-alone finalize stays only for an idempotent capture replay, which returns the stored 200 without running the hook. The merchant API capture route passes no hook, so it is unchanged. Rejected: a recovery sweep (no column ties a transaction to its link until finalize writes it, so it would need a `LIKE` scan over idempotency keys on every pay); moving the whole pay flow into one transaction (PL-1's first version, which starved the pool); stopping the claim from re-taking a reserved link (breaks stale-lease recovery for requests that died before any capture). Limit: the acquirer call sits inside the capture transaction (`capture.ts:175`), so if the lease is lost during a capture that takes longer than 60 s, our books roll back to one capture but the acquirer has already been asked once; that is an acquirer reconciliation case, as for any rollback after the acquirer call.
*Proof:* `CAP-6: a crash right after the capture commits never leaves captured money on a link that is still payable` (`apps/api/src/paymentLinks/pay.crash.audit.test.ts`) simulates the API dying at the stand-alone finalize. Before the fix: `captured 1 but the link is 'reserved'`; after, it passes. `payments/capture.audit.test.ts`, `routes/paymentLinks.test.ts` and `paymentLinks/pay.test.ts` pass (20/20), `tsc --noEmit` clean. Runtime re-run, same load and the same `kill -9` mid-run (`lt-20261030141817`): `captured_link_unpaid` 0, `links_paid` 1,902 = `captured` 1,902, `double_captured` 0, `paid_not_captured` 0, ledger and outbox checks 0. Five checkouts were paid while their client saw only the dropped connection; their links read `paid`, so a retry gets 409 `payment_link_already_paid`. The 16 reserved links and 6 authorized-only transactions are requests that died before capture: no money moved. PL-1c lines: prod +11/-2 (`capture.ts` +3/-1, `pay.ts` +8/-1), test +83/-0.

Lines: prod +21/-7 (PL-1 + PL-1b net on `pay.ts` +10/-5, `104c871` + `f487401`; PL-1c +11/-2, `4d2527c`), test +145/-0 (+40, +22, +83).
