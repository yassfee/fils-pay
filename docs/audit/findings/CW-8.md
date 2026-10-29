### CW-8 · The API cannot boot in development: the built-in webhook key is 34 bytes · FP-300 (☐6), G4 · Severity: Medium
**What's wrong:** with `NODE_ENV` not set to production and no `WEBHOOK_SECRET_ENCRYPTION_KEY`, `loadConfig()` falls back to a built-in dev key and then rejects it, so the API throws at startup.

**Why it happens:** `apps/api/src/config.ts:153` `DEV_FALLBACK_WEBHOOK_KEY_B64` decodes to the text `test-key-for-dev-only-not-for-prod`, which is 34 bytes. The validator (`config.ts:157-175`) requires exactly 32 raw bytes for AES-256-GCM and throws `WEBHOOK_SECRET_ENCRYPTION_KEY must base64-decode to exactly 32 bytes, got 34`. Every test passes its own valid key, so the fallback was never exercised.

**What it breaks:** `npm run dev` and `docker compose up` (which, as shipped, loaded no env file) never start the API, so nobody can run the app locally the way the case file asks.

**Why it needed a fix:** a fresh checkout cannot run at all.

**Fix:** `apps/api/src/config.ts:153`
```diff
-const DEV_FALLBACK_WEBHOOK_KEY_B64 = "dGVzdC1rZXktZm9yLWRldi1vbmx5LW5vdC1mb3ItcHJvZA==";
+const DEV_FALLBACK_WEBHOOK_KEY_B64 = "dGVzdC1rZXktZm9yLWRldi1vbmx5LW5vdC00LXByb2Q=";
```
(the same idea, `test-key-for-dev-only-not-4-prod`, 32 bytes). Lines: prod +1/−1, test +10/−0. Commit bf810ef.

**Why this is the smallest correct fix:** one constant. Production is unchanged: the fallback is never used there, and a missing key still fails fast. Why not relax the validator: the 32-byte check is correct for AES-256.

**Proof:** `config.audit.test.ts` "non-production boot without WEBHOOK_SECRET_ENCRYPTION_KEY falls back to a 32-byte dev key": before `got 34`, after pass.

**Regression risk:** webhook secrets encrypted with the old dev key cannot be read with the new one. That only affects throwaway dev databases, which could never have booted anyway.

**Trap note:** `ops/docker-compose.yml` said "WEBHOOK_SECRET_ENCRYPTION_KEY isn't needed in dev; the api uses a built-in dev key (copilot, pasted by FH — unverified)". False, and corrected in the compose commit.
