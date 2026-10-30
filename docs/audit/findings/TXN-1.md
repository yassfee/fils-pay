### TXN-1 · withTransaction lets a failing ROLLBACK mask the real error and returns the broken client to the pool ·  · Severity: Low

**Lead:** Team 45 heads-up list (C7), verified by us.

**What's wrong:** When `fn` throws, `withTransaction` awaits `ROLLBACK` before rethrowing. If the `ROLLBACK` itself throws (connection reset, server restart, pool timeout), that error replaces the original one. The caller and the error log then report "rollback failed" instead of the unique violation or bug that actually aborted the write. The client is also released with a plain `release()`, so a connection left in an unknown transaction state can go back into the pool.

**Why it happens:** `apps/api/src/db/withTransaction.ts:33-38` (before the fix) ran `await client.query("ROLLBACK"); throw err;` in the catch, so a rejection at the first line skips the second. The `finally` calls `client.release()` with no error. pg-pool destroys a client only when it gets an error or the connection is already flagged unusable (`pg-pool/index.js:392`), so a live connection whose ROLLBACK failed is pooled again. The comment thread above the function names exactly this (FH: "ROLLBACK can itself throw and mask the original error", am: "release(err)"), and it was dismissed without a fix.

**What it breaks:** Every multi-statement write in the API (capture, refund, payment-link pay, signup, KYC review, admin actions) runs through this helper. During a database blip, an error-mapping branch such as `isUniqueViolation` in `onboarding/signup.ts:107-114`, or any AppError thrown inside `fn` (409, 422 and so on), gets the rollback error instead. A request that should have returned a clean 4xx turns into a 500, and the real root cause never reaches the logs. If the connection is still alive after the failed ROLLBACK, the next request that borrows it starts inside an aborted transaction and fails too.

**Why it needed a fix:** On money paths the cause of a failed write is the thing operators need, and a poisoned pooled connection spreads one failure to unrelated requests.

**Fix:** `apps/api/src/db/withTransaction.ts:26, 35, 39`
```diff
   const client = await pool.connect();
+  let releaseErr: Error | undefined; // TXN-1: set when ROLLBACK fails, so pg destroys the client
   try {
 ...
     } catch (err) {
-      await client.query("ROLLBACK");
+      await client.query("ROLLBACK").catch((rollbackErr: Error) => { releaseErr = rollbackErr; }); // TXN-1: never mask err
       throw err;
     }
   } finally {
-    client.release();
+    client.release(releaseErr);
   }
```

**Why this is the smallest correct fix:** Three lines in the one helper every transactional write uses. The original error is always rethrown, and the rollback failure is passed to `release(err)`, the documented pg-pool way to destroy rather than recycle a client (this is am's suggestion in the comment thread). *Why not just swallow the ROLLBACK error (`.catch(() => {})`)?* That fixes the masking but still pools a client in an unknown state. *Why not log the rollback error?* `withTransaction` has no logger, and adding one changes its signature for every caller. pg-pool also emits it through the destroy path. The happy path and the normal rollback path are byte-for-byte unchanged: `release(undefined)` is `release()`.

**Proof:** `TXN-1: a ROLLBACK failure neither masks the original error nor returns the client to the pool` (`apps/api/src/db/withTransaction.audit.test.ts`, a unit test with a stub client whose ROLLBACK rejects).
Before: `actual: { thrown: 'rollback failed: connection reset', released: [undefined] }`.
After: `{ thrown: 'insert failed: unique violation', released: [rollbackErr] }`. `db/pool.test.ts` and `routes/auth.audit.test.ts` pass, and `tsc --noEmit` is clean. The full API suite exercises the helper on every write path.

**Regression risk:** Very low. Behaviour changes only when ROLLBACK itself fails: the caller then sees the original error, and the connection is discarded and replaced by the pool.

Lines: prod +3/-2, test +30/-0
