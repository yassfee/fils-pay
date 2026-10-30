### API-12 · Public signup with a non-string password crashes with a 500 · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.
**Category:** Bug

**What's wrong:** the unauthenticated `POST /v1/merchants` (signup) with `"owner": {"email": "...", "password": 12345678901}` answered `500 internal_error`; the log shows `TypeError: The first argument must be of type string or an instance of Buffer … Received type number`. HUNT-4 fixed the same route's 500s for a bad `businessType`/`country`; this input is a different one.

**Why it happens:** the route (`apps/api/src/routes/businessProfile.ts:27-38`) checks the owner fields only for truthiness (`!owner.password`), so any non-empty JSON value passes. `createMerchantWithOwner` then calls `hashPassword(input.owner.password)` (`apps/api/src/onboarding/signup.ts:44`), and argon2 throws a plain `TypeError` for a number, which the error handler turns into a 500.

**What it breaks:** anyone on the internet can produce error-level 500s on the public signup route, and a client that serialises the password as a number gets "internal error" instead of a validation message. No account is created (the hash runs before the insert).

**Why it needed a fix:** malformed client input must be a 4xx; the route already answers 400 `invalid_request` for every other malformed signup body.

**Fix:** `apps/api/src/routes/businessProfile.ts`, after the HUNT-4 check:
```diff
+    if (typeof owner.email !== "string" || typeof owner.password !== "string") {
+      throw new BadRequestError("invalid_request", "owner email and password must be strings"); // API-12: a numeric password crashed argon2 (500)
+    }
```

**Why this is the smallest correct fix:** one guard next to the existing signup validation, with its error code. `email` is checked with it because a non-string email is stored as the login identifier, which the login route (a string lookup) can never match. *Why not guard inside `hashPassword`?* It is shared with login and admin login (frozen this wave), and the bad input should be refused where the body is validated.

**Proof:** `API-12: signup with a non-string owner password is a 400, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500`, and passes after, with no `merchant_users` row created.

**Regression risk:** only non-string `owner.email`/`owner.password` values change (500 or 201 to 400). `src/app.test.ts` (signup, login, OTP verify) and `src/routes/auth.audit.test.ts` pass.

Lines: prod +3/-0, test +17/-0
