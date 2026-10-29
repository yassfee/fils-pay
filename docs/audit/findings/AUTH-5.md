### AUTH-5 · OTP attempt limit is check-then-act: parallel guesses bypass max_attempts · H8 · Severity: High

**What's wrong:** Merchant and admin `/otp/verify` read `attempt_count`, compared it in JavaScript, checked the code, and only then incremented, with no transaction or lock. A burst of concurrent guesses on one pending cookie all read the same stale count, so each one gets a guess.

**Why it happens:** `apps/api/src/routes/auth.ts:144-167` runs a pool `SELECT attempt_count, max_attempts` (`:144`), then `if (challenge.attempt_count >= challenge.max_attempts)` (`:157`), then `verifyOtpCode`, then an unconditional `UPDATE ... attempt_count + 1` (`:164`). `apps/api/src/routes/adminAuth.ts:135-158` is the same. The comments hid the race: `auth.ts:155` "am: check-then-increment is fine ... worst case is 5 guesses" and `adminAuth.ts:147` "admin path doesn't have the merchant race, the challenge row is read FOR UPDATE — MK". No `FOR UPDATE` exists.

**What it breaks:** With `OTP_MAX_ATTEMPTS=5`, 20 concurrent wrong guesses on one pending cookie were all checked (the audit test observed 20 `invalid_code` responses, for both merchant and admin). A 6-digit OTP then falls to parallel brute force within the challenge TTL, and the cap only limits sequential guesses.

**Why it needed a fix:** H8 requires the second factor to resist guessing. The attempt cap is the only brute-force control on a 10^6 code space.

**Fix:** `apps/api/src/routes/auth.ts:155-167` (identical change in `routes/adminAuth.ts:147-159` on `admin_otp_challenges` / `revokeAdminSession`)
```diff
-      // am: check-then-increment is fine, max_attempts=5 so worst case is 5 guesses
-      // MK: 5 guesses per parallel batch? if i fire 50 at once they all read attempt_count=0
-      if (challenge.attempt_count >= challenge.max_attempts) {
+      // AUTH-5 (H8): reserve the attempt atomically before checking the code, so parallel guesses can't exceed the cap.
+      const reserved = await app.db.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1 AND attempt_count < max_attempts`, [challenge.id]);
+      if (reserved.rowCount === 0) {
         await revokeSession(app.db, pending.sessionId);
         throw new TooManyRequestsError("too_many_attempts");
       }
       const matches = verifyOtpCode(code, challenge.code_salt, challenge.code_hash);
       if (!matches) {
-        await app.db.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`, [
-          challenge.id,
-        ]);
         throw new UnauthorizedError("invalid_code");
```
Commit: this commit. Lines: prod +6/-12 (two routes), test +68/-0.

**Why this is the smallest correct fix:** A single conditional `UPDATE` reserves the attempt and enforces the cap in one atomic statement. Postgres row locking serialises concurrent updates on the row, so at most `max_attempts` requests ever reach `verifyOtpCode`. The old post-hoc increment is removed because the reservation already counted the attempt. *Why not wrap it in a transaction with `SELECT ... FOR UPDATE`?* That needs more lines and holds a pooled connection across the hash compare. *Why not a new migration or constraint?* None is needed, because the existing `max_attempts` column is the cap. Semantics are unchanged: attempts 1 through 5 are allowed, a correct code on attempt 5 still succeeds, and attempt 6 gets 429 and revokes the session.

**Proof:** `AUTH-5: parallel wrong OTP guesses cannot exceed max_attempts` (`apps/api/src/routes/auth.audit.test.ts`) and `AUTH-5: parallel wrong admin OTP guesses cannot exceed max_attempts` (`apps/api/src/routes/adminAuth.audit.test.ts`) fail before the fix with `assert.ok(checked <= config.otpMaxAttempts)` → "20 guesses were checked; cap is 5". Both pass after the fix.

**Regression risk:** The sequential wrong-code-then-right-code flows in `src/app.test.ts` and `src/routes/admin.test.ts` pass (53/53 with the audit tests). A correct code now also uses one attempt, which is invisible to the user because the cap check still runs before verification.

**Trap note:** The false "read FOR UPDATE" claim at `adminAuth.ts:147` and the "check-then-increment is fine" note at `auth.ts:155` are replaced by an accurate AUTH-5 comment. The new admin test file adds `adminAuth.audit.test.ts` (+52 test lines).
