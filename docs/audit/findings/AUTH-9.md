### AUTH-9 · OTP verify never re-issues the merchant cookie, so fp_sid keeps the 10-minute pending Max-Age · Severity: Low

**Lead:** Team 45 heads-up list (W1) and our 03_findings AUTH-9, verified by us.

**What's wrong:** After a successful merchant OTP verify, the browser still holds `fp_sid` with the `Max-Age=600` it got at login, while the server-side session row now lives 12 hours. The browser drops the cookie 10 minutes after login, so every merchant is logged out 10 minutes into each session. The admin plane does not have this problem because it re-sets its cookie at verify.

**Why it happens:** `POST /v1/auth/login` sets the cookie with `maxAge: app.config.pendingSessionTtlMinutes * 60` (`apps/api/src/routes/auth.ts:98-104`, 600 s by default, `config.ts:206`). `POST /v1/auth/otp/verify` calls `promoteSession`, which moves `expires_at` to 12 h (`auth/sessions.ts:56-59`), but the handler then sends JSON only and never calls `reply.setCookie` (`routes/auth.ts:182-186` before the fix). The admin verify does re-set its cookie at the full TTL (`routes/adminAuth.ts:178-184`). The `MK` comment at `routes/auth.ts:169-170` ("the cookie maxAge doesn't matter") is wrong: the browser enforces Max-Age.

**What it breaks:** A merchant logs in at 09:00 and verifies the OTP. At 09:10 the browser expires `fp_sid`, and the next dashboard call gets 401 `unauthenticated`, even though the `sessions` row is valid until 21:00. This is the "10 min logouts" symptom in the code comments. The session row is also left live and unrevoked for the remaining 11 h 50 min, without the user knowing.

**Why it needed a fix:** H8 asks whether the OTP flow is still safe and sound. A second factor that logs every user out 10 minutes after they pass it is broken from start to end. Users who are logged out repeatedly also repeat the password-and-OTP flow many times a day, which multiplies OTP traffic and phishing exposure.

**Fix:** `apps/api/src/routes/auth.ts:182-183`
```diff
+      // AUTH-9: re-issue the cookie at the promoted session's TTL; the login cookie had the 10-minute pending Max-Age.
+      reply.setCookie(app.config.cookieName, rawToken, { httpOnly: true, path: "/", sameSite: "lax", secure: app.config.cookieSecure, maxAge: app.config.sessionTtlHours * 3600 });
       reply.code(200).send({
```

**Why this is the smallest correct fix:** This line copies the admin verify (`routes/adminAuth.ts:178-184`), with the same attributes as the login cookie and only `maxAge` changed. *Why not lengthen the login cookie's Max-Age?* The pending session would then outlive its 10-minute server window in the browser. That is harmless but misleading, and it does not match the admin plane. *Why not also rotate the token at promotion (the lead's fixation hardening)?* Rotation changes the API contract: a client would have to swap to a new cookie after verify. Every existing caller that keeps the login cookie would break, including `app.test.ts:111` (`signupLoginAndVerify` returns the login cookie for post-verify use), `routes/auth.audit.test.ts:66-68`, and the admin test helpers. Hidden regression tests most likely follow the same pattern. The fixation exposure that rotation would close is narrow, as the verifier noted: the pending cookie is HttpOnly and tied to the account whose password was just checked, so an attacker must already hold both the password and the victim's pre-OTP cookie. We record rotation as a follow-up hardening item for both planes (`auth/sessions.ts:51-62`, `adminAuth/sessions.ts:67-78`), to ship alongside a client change.

**Proof:** `AUTH-9: OTP verify re-issues fp_sid with the full session Max-Age` (`apps/api/src/routes/auth.audit.test.ts`).
Before: `not ok 3 - AUTH-9 ... error: 'verify must re-set fp_sid, got: no Set-Cookie'`.
After: `ok 3`. The file passes 3/3, and `src/app.test.ts` passes 10/10.

**Regression risk:** Very low. The cookie value is the same token, so callers that kept the login cookie still work. Only the browser-side lifetime changes. Logout still clears the cookie with `maxAge: 0` (`routes/auth.ts:298-304`).

Lines: prod +2/-0, test +14/-0
