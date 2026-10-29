### AUTH-7 · OTP resend resets the guess budget · H8 · Severity: Medium
**What's wrong:** `POST /v1/auth/otp/resend` issues a fresh OTP challenge whose `attempt_count` starts at 0, so each resend grants 5 new guesses.

**Why it happens:** the resend handler (`apps/api/src/routes/auth.ts:195-240`) reads the previous challenge's `id, created_at` only (`:204-206`), consumes it and calls `issueChallenge`, whose INSERT (`auth/otp.ts:48-51`) leaves `attempt_count` at the 0011 default of 0. The docstring right above (`:191-194`) promises "the new challenge inherits the previous challenge's attempt_count so a resend never resets the guess budget", which the code never did. The only brake is the 30-second resend throttle.

**What it breaks:** instead of 5 guesses per login, a pending session gets 5 guesses every 30 s for its 10-minute life: 20 resends × 5 = **100 guesses, 20× the intended budget** (a 1-in-10,000 chance per pending session instead of 1 in 200,000), repeatable with every re-login. H8: "the OTP implementation changed at some point. is it still safe?". Not with this.

**Why it needed a fix:** the OTP is the second factor that AUTH-1 now actually enforces; an unlimited guess budget turns it back into a formality.

**Fix:** `apps/api/src/routes/auth.ts`
```diff
-    const existing = await app.db.query<{ id: string; created_at: Date }>(
-      `SELECT id, created_at FROM otp_challenges WHERE id = $1`,
+    const existing = await app.db.query<{ id: string; created_at: Date; attempt_count: number }>(
+      `SELECT id, created_at, attempt_count FROM otp_challenges WHERE id = $1`,
 ...
+      if (existingChallenge) await client.query(`UPDATE otp_challenges SET attempt_count = $2 WHERE id = $1`, [challenge.id, existingChallenge.attempt_count]);
```
Lines: prod +3/−2, test +24/−0.

**Why this is the smallest correct fix:** it carries one number from the old challenge to the new one, inside the existing transaction, which is exactly what the docstring promised. An already exhausted challenge stays exhausted because AUTH-5's atomic check compares `attempt_count < max_attempts`, so no separate pre-check is needed. Why not change `issueChallenge`'s signature to accept a starting count? It is shared with login, a wider change.

**Proof:** `app.test.ts` "OTP resend keeps the attempt budget" (4 wrong guesses, resend, 2 wrong guesses): before the 6th guess got `401` (`expected: 429, actual: 401`), after `429 too_many_attempts`. app + auth + admin suites 60/60; `tsc` clean.

**Regression risk:** none for honest users (5 guesses per login, as designed). Admin OTP resend, if added later, needs the same line.

**Trap note:** the docstring (`:191-194`) described intended behaviour as if it were implemented. It is now true. `auth/sessions.ts:114-115` ("FH: OTP brute force through resend?" dismissed by "MK: 5/14 was webhooks") had already spotted it.
