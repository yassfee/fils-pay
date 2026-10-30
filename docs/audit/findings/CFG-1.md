### CFG-1 · Any unknown NODE_ENV (for example "prod") silently boots as development: OTP codes in responses, non-Secure cookies, production checks skipped · H8 · Severity: Medium

**Lead:** Team 45 heads-up list (P11), verified by us.

**What's wrong:** `parseNodeEnv` mapped every value other than the exact strings `production`, `test` and `development` to `development`. A deployment with `NODE_ENV=prod`, `Production` or `staging` booted with no error as a development server.

**Why it happens:** `apps/api/src/config.ts:121-126` falls through to `return "development"` for any string. Every security default keys off `nodeEnv`: `otpDevExpose` defaults to `nodeEnv !== "production"` (`config.ts:210`), so `devOtpCode` goes into the login response (`routes/auth.ts:111-113`, and the admin twin). `cookieSecure` defaults to `nodeEnv === "production"` (`:228`). The required-secret checks for `SETTLEMENT_INTERNAL_TOKEN` and `ACQUIRER_CALLBACK_SIGNING_SECRET` run only when `nodeEnv === "production"` (`:186-192`). The webhook-secret key falls back to a public dev key (`:248`). The notifier comment at `auth/notifier.ts:14-15` shows staging already ran with NODE_ENV unset or misconfigured.

**What it breaks:** An operator sets `NODE_ENV=prod`. `POST /v1/auth/login` now returns `{"otpRequired":true,"devOtpCode":"482913"}`, so the second factor is handed to whoever knows the password (H8). Session cookies are sent without `Secure`. The service also boots without the settlement token and the acquirer signing secret, and encrypts webhook secrets under the dev key committed in the repo. There is no error and no log line.

**Why it needed a fix:** H8 asks whether OTP is still safe. A one-character configuration typo should never disable two-factor auth and the production secret checks without a word. A configuration error must fail loudly at boot.

**Fix:** `apps/api/src/config.ts:125`
```diff
     return value;
   }
+  if (value) throw new Error(`loadConfig: unknown NODE_ENV "${value}" (expected production, test or development)`); // CFG-1
   return "development";
 }
```

**Why this is the smallest correct fix:** One line at the single parser every config value depends on. Only an unset or empty `NODE_ENV` still defaults to development, so local `npm run dev`, tests that omit it, and `ops/demo.sh` and `ops/smoke.sh` behave as before. *Why not map unknown values to production (fail closed)?* That would silently turn a typo'd dev box into production mode, where it then fails on missing secrets with a misleading message. An explicit error names the actual problem. *Why not normalise case or aliases (`prod` → `production`)?* That guesses intent, and it is more code. Checked: `ops/.env.docker:9` and `ops/.env.production.example:3` set `NODE_ENV=production`, and `loadConfig` with each still boots. Compose and `Dockerfile.node` set no other value. All 30 test files pass `NODE_ENV: "test"`, and `config.audit.test.ts` passes `"development"`.

**Proof:** `CFG-1: an unknown NODE_ENV is refused; an unset one still defaults to development` (`apps/api/src/config.audit.test.ts`).
Before: `not ok 2 ... error: 'Missing expected exception.'` (`NODE_ENV=prod` loaded as development).
After: `ok 2`. The file passes 2/2, and both ops env files boot.

**Regression risk:** Low. A deployment that currently relies on an unrecognised `NODE_ENV` will now refuse to boot with a clear message. That is the intent: such a deployment was running with dev security defaults.

Lines: prod +1/-0, test +7/-0
