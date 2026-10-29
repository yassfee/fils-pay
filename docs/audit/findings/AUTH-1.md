### AUTH-1 · Pending (pre-OTP) session cookie authenticates every merchant route · G4, H8 · Severity: Critical

**What's wrong:** `lookupSession`, which backs `requireSession` and `requireMerchantAuth`, accepted any live session row, including the pending row `/v1/auth/login` creates after the password check alone. The OTP step was decorative: a password gave full merchant access.

**Why it happens:** `POST /v1/auth/login` (`apps/api/src/routes/auth.ts:87-105`) inserts a `sessions` row with `authenticated = false` (`auth/sessions.ts:31-32`) and sets the `fp_sid` cookie to its raw token. `lookupSession` (`auth/sessions.ts:89-92`) reads the `live_sessions` view (`db/migrations/0058_live_sessions.sql:11-12`), which filters only `revoked_at IS NULL AND expires_at > now()`. The `authenticated = true` term that the 0012 contract requires (`0012_sessions.sql:4-6`) was dropped when liveness moved into the view, and the query never added it back. The admin lookup (`adminAuth/sessions.ts:124`) keeps the term.

**What it breaks:** The lead confirmed this at runtime. With a correct password and no OTP, the pending cookie got 200 on `GET /v1/auth/me` and `GET /v1/transactions`. An owner's pending cookie also passes `requireRole('owner')` on `POST /v1/merchants/:id/api-keys`, so it can mint a non-expiring API key within the 10-minute pending window. Together with AUTH-2, the password does not even have to be the victim's.

**Why it needed a fix:** H8 requires two-factor merchant login. Left alone, a stolen or guessed password alone opens every dashboard and API-key route, and the second factor is bypassed for every merchant.

**Fix:** `apps/api/src/auth/sessions.ts:92`
```diff
-      WHERE s.token_hash = $1`,
+      WHERE s.token_hash = $1 AND s.authenticated = true`,
```
Commit: this commit. Lines: prod +1/-1, test +38/-1 (corrected from git numstat).

**Why this is the smallest correct fix:** `lookupSession` is the single function every merchant-authenticated route uses (`auth/middleware.ts:38`, `auth/requireMerchantAuth.ts:53`), and the view already exposes `authenticated`. *Why not change the view (migration)?* `live_sessions` has no other consumer, so a new migration adds schema churn without closing anything more. *Why not check in each middleware?* That is two call sites instead of one, and it leaves the lookup lying about its contract. OTP verify and resend use `lookupPendingSession`, which reads `authenticated = false`, so they keep working, and dev mode still returns `devOtpCode`.

**Proof:** `AUTH-1: lookupSession returns null for a pending (pre-OTP) session` (`apps/api/src/auth/sessions.audit.test.ts`) fails before the fix with `assert.equal(await lookupSession(pool, rawToken), null, "a pending session must not authenticate")`: the actual value is a `{sessionId, merchantUserId, merchantId, role}` object. It passes after the fix.

**Regression risk:** A flow that uses the cookie before OTP verify now gets 401, which is the intended contract. `src/app.test.ts` (login, OTP verify, then dashboard calls) passes 9/9. `auth/sessions.test.ts` and `auth/otp.test.ts` pass. Deployment caveat from the dossier: in production the notifier only logs, so OTP delivery has to ship alongside this fix.

**Trap note:** `auth/sessions.test.ts:79` said "MK: covered in routes/auth.test.ts", but no such file exists. That line now points to the audit test. Other misleading claims, left as-is because they live in files we do not own: `routes/auth.ts:49-50` ("A pending session authenticates nothing until promoted"), which is now true; `routes/apiKeys.ts:34-35`; `docs/ARCHITECTURE.md:67-68`; and `auth/sessions.ts:69`, whose doc comment is now accurate.
