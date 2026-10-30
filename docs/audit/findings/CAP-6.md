### CAP-6 · A crash between the capture commit and "link paid" leaves captured money on a link that can be paid again · INCIDENT 2026-05-14 · Severity: High

**What's wrong:** `payPaymentLink` commits the capture (money moved, ledger written) in one transaction, then marks the link `paid` in a separate statement. If the API dies in between, the link stays `reserved` while its money is captured. After the 60 s lease anyone can claim the link again. A buyer who reloads the page (new Idempotency-Key) is charged a second time, and the first capture is linked to nothing.

**Why it happens:** `apps/api/src/paymentLinks/pay.ts`: `captureTransaction(...)` runs its own `withTransaction` and COMMITs (`payments/capture.ts:94-274`). Only after it returns does Step 4 run `UPDATE payment_links SET status = 'paid' ... transaction_id = $2` through `pool.query`, which commits on its own. The claim's stale-lease branch (`status = 'reserved' AND reserved_at < now() - timeout`) then lets a new request re-reserve the link. The PL-1 fence only protects a holder whose lease is alive. It cannot see that an earlier holder's capture already committed.

**What it breaks:** The judged overload test ("restarts itself and recovers without losing data"). One `kill -9` of the API in the middle of a 60-user run (`lt-20261030140945`, before this fix) left:
- 3 transactions `captured` whose link was not `paid` (`captured_link_unpaid` = 3 in `ops/loadtest-check.sql`), with ledger legs and outbox events;
- 27 links stuck `reserved`.

Each of those 3 links can be paid again after 60 s, which is a double charge. The client saw a network error, and the public link still read `reserved`, so nothing over the API showed that the money had moved. An OOM kill or a restart under load does the same thing.

**Why it needed a fix:** Restarting under overload is exactly what the judges test. A double charge on one payment link is the 2026-05-14 incident class ("two customers charged on one link").

**Fix:** `apps/api/src/payments/capture.ts` (+3/-1), `apps/api/src/paymentLinks/pay.ts` (+8/-1)
```diff
 // capture.ts
-import type { Pool } from "pg";
+import type { Pool, PoolClient } from "pg";
+  onCaptured?: (client: PoolClient) => Promise<void>; // CAP-6: runs inside this capture's transaction
+    await input.onCaptured?.(client);
     await completeIdempotencyKey(client, claim.row.id, { statusCode: 200, body, resourceId: txn.id });
 // pay.ts
+  let finalizedInCapture: { rows: Array<{ id: string; paid_at: Date }> } | undefined;
   const captureResult = await captureTransaction(pool, acquirer, {
     ...
+    onCaptured: async (client) => {
+      finalizedInCapture = await client.query(`UPDATE payment_links SET status = 'paid', ... WHERE id = $1 AND status = 'reserved' AND reserved_at::text = $3 RETURNING id, paid_at`, [link.id, txnId, fence.rows[0]!.lease]);
+      if (!finalizedInCapture.rows[0]) throw new ConflictError("payment_link_processing"); // lease lost: roll the capture back
+    },
   });
-  const finalizeResult = await pool.query<{
+  const finalizeResult = finalizedInCapture ?? await pool.query<{
```
The link is marked `paid` inside the capture's own transaction, with the same fenced UPDATE as before. The money and the link status now commit together or not at all. If the lease was lost, the capture rolls back instead of charging. The stand-alone finalize stays as the path for an idempotent capture replay, which returns the stored 200 without running the hook.

**Why this is the smallest correct fix:** It makes the two writes atomic at the one point where they were split, and changes nothing else in either function.
- *Why not a recovery sweep that finds captured transactions on reserved links?* No column links a transaction to its link until finalize writes it. Recovery would have to parse idempotency keys (`paylink:<id>:...:capture`), which means a full-table `LIKE` scan on every pay.
- *Why not move the whole pay flow into one transaction?* PL-1 tried and rejected that shape (it holds the link row lock across two acquirer calls). The hook adds only the final UPDATE to a transaction that is already open.
- *Why not stop the claim from re-taking a reserved link?* That breaks the legitimate stale-lease recovery for buyers whose request died before any capture.

**Proof:**
- `CAP-6: a crash right after the capture commits never leaves captured money on a link that is still payable` (`apps/api/src/paymentLinks/pay.crash.audit.test.ts`) simulates the API dying at the stand-alone finalize statement. Before the fix: `captured 1 but the link is 'reserved'`. After the fix it passes.
- `payments/capture.audit.test.ts`, `routes/paymentLinks.test.ts` and `paymentLinks/pay.test.ts` pass (20/20 with the new test), and `tsc --noEmit` is clean.
- Runtime, same overload and the same `kill -9` in the middle of the run, after the fix (`lt-20261030141817`):
  - `captured_link_unpaid` 0, and `links_paid` 1,902 equals `captured` 1,902.
  - `double_captured` 0, `paid_not_captured` 0, ledger and outbox checks 0.
  - 5 checkouts were paid while the client saw only the dropped connection. Their links read `paid`, so a retry
    gets 409 `already_paid`.
  - The 16 reserved links and 6 authorized-only transactions are requests that died before capture: no money moved.

**Regression risk:** The capture transaction now also holds the `payment_links` row lock from the finalize UPDATE until COMMIT, a few milliseconds after the acquirer call. Only this link's own claim UPDATE could wait on it, and that claim would then see `paid`. The merchant API capture route (`routes/transactions.ts`) passes no hook, so it is unchanged.

Lines: prod +11/-2, test +83/-0
