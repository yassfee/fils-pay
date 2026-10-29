### AUTH-4 · OTP codes and payment-link tokens come from Math.random · H8 · Severity: High

**What's wrong:** `randomDigits` (merchant and admin OTP codes) and `randomFromAlphabet` (payment-link tokens) in `apps/api/src/lib/random.ts` drew from `Math.random()`. That is V8's xorshift128+ PRNG, which is not cryptographically secure.

**Why it happens:** `lib/random.ts:4` was `Math.floor(Math.random() * max)` and `:13` was `alphabet[Math.floor(Math.random() * alphabet.length)]`. `auth/otp.ts:8` (`generateOtpCode`) calls `randomDigits`, and `adminAuth/otp.ts` reuses `generateOtpCode`. `paymentLinks/create.ts` builds link tokens with `randomFromAlphabet`.

**What it breaks:** xorshift128+ state can be recovered from a handful of consecutive outputs. A self-signed-up merchant who triggers several logins and reads their own `devOtpCode` values, or sees enough of their own payment-link tokens, can predict the next codes and tokens the same process issues. That includes a victim's OTP, or an admin's OTP after a phished password. A payment-link token is the only secret a payer needs (0020).

**Why it needed a fix:** H8 requires a real second factor and unguessable bearer tokens. A predictable OTP turns two-factor login into password-only login, and a predictable link token exposes other merchants' payment links.

**Fix:** `apps/api/src/lib/random.ts:1,4,13`
```diff
+import { randomInt } from "node:crypto"; // AUTH-4 (H8): CSPRNG, never Math.random
+
-  return Math.floor(Math.random() * max)
+  return randomInt(max)
-    out += alphabet[Math.floor(Math.random() * alphabet.length)];
+    out += alphabet[randomInt(alphabet.length)];
```
Commit: this commit. Lines: prod +3/-2, test +19/-0.

**Why this is the smallest correct fix:** Both security callers go through these two functions, so replacing the source of randomness here fixes OTPs (merchant and admin) and link tokens at once. Signatures and output formats are unchanged. `crypto.randomInt` is uniform with no modulo bias and accepts ranges up to 2^48, which covers OTP lengths up to 14 digits; the configured length is 6. *Why not switch each caller to `lib/crypto.randomToken`?* That changes the token format and touches several files.

**Proof:** `AUTH-4: randomDigits and randomFromAlphabet do not depend on Math.random` (`apps/api/src/lib/random.audit.test.ts`) pins `Math.random = () => 0`. Before the fix it fails with `OTP codes followed Math.random: 000000` (all 20 codes are identical). After the fix it passes.

**Regression risk:** The output shape is unchanged: zero-padded digits and alphabet characters. `auth/otp.test.ts` and `routes/paymentLinks.test.ts` pass (14/14 with the audit test). `displayReference()` also moves to the CSPRNG, which is harmless.

**Trap note:** The quarantined AI configs (CLAUDE.md, AGENTS.md, .cursorrules) called Math.random "acceptable" because "uniqueness is enforced at the DB", but uniqueness is not unpredictability. `adminAuth/otp.ts:13` ("Generated with crypto.randomInt") is now true. `auth/otp.test.ts:19`, a statistical sanity test, passes with any PRNG. Not fixed, outside the owned files: `admin/inviteCode.ts:10` also uses `Math.random` for invite codes.
