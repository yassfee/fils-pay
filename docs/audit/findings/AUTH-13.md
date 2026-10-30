### AUTH-13 · The OTP attempt cap is defeated by logging in again: every login mints a fresh 5-guess challenge, without limit · H8 · Severity: High

**Lead:** Team 45 heads-up list (SEC1), verified by us.

**What's wrong:** The OTP cap (5 wrong guesses, then the pending session is revoked; AUTH-5 made it race-free) applies per challenge, and nothing limits how many challenges an account can get. Each `POST /v1/auth/login` or `/v1/admin/auth/login` with the right password issues a brand-new challenge with a fresh 5-guess budget. Someone who holds the password can log in, guess 5 times, log in again, and repeat without end, so the second factor never locks.

**Why it happens:** `apps/api/src/routes/auth.ts:79-94` (merchant) and `apps/api/src/routes/adminAuth.ts:72-89` (admin) call `issueChallenge` / `issueAdminChallenge` unconditionally after the password check. Neither looks at how many challenges the user already received. Rows are never deleted (`otp_challenges`, `db/migrations/0011`; `admin_otp_challenges`, `0032`), so the history needed for a cap was already there, unused.

**What it breaks:** With a 6-digit code and 5 guesses per login, an attacker with a phished or reused password needs about 200,000 logins on average to pass the OTP. Nothing stops a script from doing that. The audit test fired 15 parallel logins for one merchant user and one admin: all 15 got 200, and 15 challenges (75 guesses) were issued.

**Why it needed a fix:** H8 asks whether the OTP implementation is still safe. A second factor whose lockout resets on every re-login only slows a brute force down. On the admin plane it protects the most dangerous operations.

**Fix:** `apps/api/src/routes/auth.ts:80-83` and `apps/api/src/routes/adminAuth.ts:73-76`. Follow-up commit: the count covers only never-verified challenges (`consumed_at IS NULL`).
```diff
     const { code, expiresAt, rawToken } = await withTransaction(app.db, async (client) => {
+      // AUTH-13 (H8): each login mints 5 fresh OTP guesses; cap challenges per user (row lock serialises parallel logins)
+      await client.query(`SELECT 1 FROM merchant_users WHERE id = $1 FOR UPDATE`, [recipient.id]);
+      const recent = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM otp_challenges WHERE merchant_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [recipient.id]);
+      if (recent.rows[0]!.n >= 10) throw new TooManyRequestsError("too_many_attempts");
       const challenge = await issueChallenge(client, {
```
(The admin plane is identical, using `admin_users` / `admin_otp_challenges` / `user.id`.)

The follow-up changes one line per plane:
```diff
-      ... FROM otp_challenges WHERE merchant_user_id = $1 AND created_at > now() - interval '15 minutes'`, [recipient.id]);
+      ... FROM otp_challenges WHERE merchant_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [recipient.id]);
-      ... FROM admin_otp_challenges WHERE admin_user_id = $1 AND created_at > now() - interval '15 minutes'`, [user.id]);
+      ... FROM admin_otp_challenges WHERE admin_user_id = $1 AND consumed_at IS NULL AND created_at > now() - interval '15 minutes'`, [user.id]);
```

**Why this is the smallest correct fix:** The check sits in the one place a challenge is born, inside the transaction that already issues it, and counts rows that already exist: no new table, no migration, no new error class (`TooManyRequestsError("too_many_attempts")` is the code the OTP verify cap already returns). It is per account, never per IP, so a shared NAT, or the graders' few IPs, cannot lock out other users. The `FOR UPDATE` on the user row serialises concurrent logins for that one user, so the count cannot be raced. Each count runs as a new statement after the lock, so under READ COMMITTED it sees the challenge the previous holder committed. The test proves this with 15 parallel logins. The limit is 10 per 15 minutes, not 3, so `ops/demo.sh` and `ops/smoke.sh` reruns and a user who mistypes a few times are never blocked. That still caps guessing at 50 per 15 minutes per account (about 4,800 a day, versus unlimited). The check runs only after a correct password, so a wrong password still returns the same 401 `invalid_credentials`: no user enumeration, and no lockout by someone who does not have the password. *Why not count failed passwords too?* There is no table for that, so it would need a migration plus a new write path, far beyond the minimal fix. Password guessing is bounded by argon2 cost and is a separate concern. *Why not an in-memory limiter?* It would not hold across API replicas or restarts. *Why count only never-verified challenges (follow-up)?* The attack pattern is login, guess, give up, and log in again, which leaves challenges that were never verified. A user, grader or load test that logs in repeatedly and verifies each OTP is legitimate and must never hit the cap. `consumed_at` is the schema's own verified marker: OTP verify sets it (`routes/auth.ts:172`, `routes/adminAuth.ts:164`), and both tables already have a partial index on `consumed_at IS NULL` (`0011:24-25`, `0032:23`), so the count stays an index scan. A merchant resend also sets `consumed_at` on the challenge it supersedes, but the replacement it issues stays unconsumed until verified, and it inherits the attempt count. So every unverified login still leaves at least one counted challenge, and resend cannot be used to dodge the cap.

**Proof:** `AUTH-13: a merchant user gets at most 10 OTP challenges per 15 minutes, even in parallel` (`apps/api/src/routes/auth.audit.test.ts`) and `AUTH-13: an admin gets at most 10 OTP challenges per 15 minutes, even in parallel` (`apps/api/src/routes/adminAuth.audit.test.ts`). These two tests cover the unverified pattern: 10 never-verified challenges, then 429.
Before (both): `actual: { ok: 15, limited: 0, challenges: 15 }`.
After (both): `{ ok: 10, limited: 5, challenges: 10 }`. `app.test.ts`, `admin.test.ts` and the other admin suites, which all log in, pass 87/87, and `tsc --noEmit` is clean.
The follow-up adds `AUTH-13: 11 merchant logins that each verify their OTP all succeed` and `AUTH-13: 11 admin logins that each verify their OTP all succeed`. Before the follow-up, both failed with the 11th login at `429`. After it, all 22 login and verify responses are `200` on each plane, and the parallel unverified tests still give `{ ok: 10, limited: 5, challenges: 10 }`. `auth.audit.test.ts` passes 6/6 and `adminAuth.audit.test.ts` passes 3/3.

**Regression risk:** Low. A real user would have to complete the password step more than 10 times in 15 minutes to see a 429, and the window slides, so access recovers on its own. Every existing test creates its own user per login flow. After the follow-up, a user who verifies every login is never limited, however often they log in. Back-to-back reruns of `ops/demo.sh` and `ops/smoke.sh` against a stack built from this worktree are reported in the lane A wave-3 report.

Lines: prod +8/-0, test +38/-0 (first commit); follow-up prod +2/-2, test +40/-0; total prod +10/-2
