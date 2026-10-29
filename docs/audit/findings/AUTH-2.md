### AUTH-2 · Login binds the OTP and session to an email-only lookup (cross-tenant takeover) · H8 · Severity: Critical

**What's wrong:** `POST /v1/auth/login` checks the password against the `(merchantId, email)` row. It then issues the OTP challenge and the pending session for whatever `findOtpRecipient(email)` returns, which is any active user with that email in any tenant.

**Why it happens:** `apps/api/src/routes/auth.ts:78` read `const recipient = await findOtpRecipient(app.db, email) ?? user;`. `findOtpRecipient` (`auth/users.ts:15-21`) runs `WHERE mu.email = $1 AND m.status = 'active' LIMIT 1`, with no merchant filter and no `ORDER BY`. Emails are unique only per merchant (`0003_merchant_users.sql:12 UNIQUE (merchant_id, email)`). `recipient.id` is then bound to the challenge (`:82`) and the session (`:88`), and `/otp/verify` promotes that session as that user (`:176-179`).

**What it breaks:** Victim V has owned tenant A with email E for some time. The attacker uses public signup (`POST /v1/merchants`) to create tenant B, with owner email E and a password the attacker chooses. The attacker logs in with B's id and that password. The password check passes for B's row, but the email-only lookup returns V's older row in A. After OTP verify, `GET /v1/auth/me` returns tenant A, so the attacker now holds the victim's owner session. In the benign case, the seed's shared owner email logs in to Beta Digital and lands in Alpha Retail.

**Why it needed a fix:** H8 requires tenant isolation for merchant login. Left alone, anyone who knows an owner's email can take over that merchant's account, including minting API keys and reading settlement data.

**Fix:** `apps/api/src/routes/auth.ts:12,78`
```diff
-import { findOtpRecipient } from "../auth/users.js";
...
-    const recipient = await findOtpRecipient(app.db, email) ?? user;
+    const recipient = user; // AUTH-2 (H8): the row whose password was just verified, never an email-only lookup
```
Commit: this commit. Lines: prod +1/-2, test +74/-0.

**Why this is the smallest correct fix:** Line 78 is the single point where the authenticated identity is swapped. Keeping the `recipient` name leaves lines 82, 88 and 97 untouched. *Why not add a merchant filter to `findOtpRecipient`?* That changes its signature and adds a redundant second query for a row we already hold. *Why not delete `auth/users.ts`?* That is 24 more changed lines with no added safety once the import is gone. The import is removed so the email-only helper has no caller left.

**Proof:** `AUTH-2: login binds the OTP and session to the user whose password was checked` (`apps/api/src/routes/auth.audit.test.ts`) fails before the fix with `assert.notEqual(merchant, victimMerchantId, "session must not land in the victim's tenant")`: `/me` returned the victim's merchant id. It passes after the fix.

**Regression risk:** Login for a user whose email is unique is unchanged, because `findOtpRecipient` returned that same row. `src/app.test.ts` passes 9/9, including the shared-email test at `:147`. `tsc --noEmit` reports no new errors.

**Trap note:** Several comments asserted that login is merchant-scoped: `db/migrations/0011_otp_challenges.sql:1-4`, `onboarding/signup.ts:37-38` ("MK: login filters by merchantId. verified"), `db/seed/fixtures/merchants.ts:87-89`, and `app.test.ts:181`, whose test uses a unique email and so cannot fail. These are outside this lane's owned files and are listed for the lead to correct. The code comment at `routes/auth.ts:78` now states the invariant.
