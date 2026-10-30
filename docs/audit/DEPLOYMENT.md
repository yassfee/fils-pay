# Deployment to Dilmune Cloud (FP-300 box 6)

**Status:** pending. Access details arrive on 2026-10-30 and the deploy happens only with the team's go-ahead.
Runbook: [`DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md). Artifacts: `ops/Dockerfile.node`, `ops/Dockerfile.go`, `ops/docker-compose.prod.yml`,
`ops/.env.production.example`, `ops/smoke.sh`, `ops/demo.sh`.

## What runs
| Service | Image | Notes |
|---|---|---|
| postgres | postgres:16-alpine | not published (prod override); internal network only |
| migrate / seed | ops-migrate / ops-seed (Node 22) | one-off jobs; migrations 0001-0099 |
| api | ops-api (Node 22, tsx) | 0.5 vCPU / 512 MB cap (384 MB heap), 503 load shedding, `/healthz` health check that restarts a wedged API, single replica (see limitation below); sizing in CAPACITY.md |
| settlement | ops-settlement (static Go, distroless) | daemon; closes the Bahrain business day after it ends |
| reporting | ops-reporting (Node 22) | outbox consumer |

## Production settings (names only; values generated on the box with `openssl rand -base64 32`)
`NODE_ENV=production`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, `SETTLEMENT_INTERNAL_TOKEN`, a **fresh**
`ACQUIRER_CALLBACK_SIGNING_SECRET` (the one committed in `ops/.env.docker` is burned, B8),
`ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true`, `COOKIE_SECURE=true` behind HTTPS, `OTP_DEV_EXPOSE=true` (**demo only**:
no OTP delivery channel exists), and `ACQUIRER_FAILURE_RATE=0`: a **demo determinism setting for the acquirer
simulator**. The decline path is still proven by `processRefund.test.ts:326` (402 `refund_declined`, nothing written)
and the REF-1/REF-1b/REF-6b tests.

## Known caveats
- **0087 (CW-1b):** a database that applied the *first* version of 0087 (full unique index, duplicates deleted) keeps
  that index, because the runner skips applied files. Fresh deploys get the final partial index (historic duplicates
  kept for finance). Our hosted database is fresh.
- **Single replica:** the webhook dispatcher can double-POST with two api replicas. Run one replica; receivers dedupe
  on `Webhook-Delivery-Id` (stable across replays since CW-6).
- **Box 3 on the hosted box:** the payout netting is shown with the Go test `NetsRefundIntoPayout` output and the saved
  local run ([`evidence/demo-run-fe69eff.log`](evidence/demo-run-fe69eff.log)); a business day closes only after it
  has ended (CLOSE-1).
- **Seed logins (deploy hardening, not a case bug):** the dev seed passwords in `db/seed/generate.ts` are public and
  `OTP_DEV_EXPOSE=true` makes the OTP no barrier, so anyone could log in to the hosted box as `finance` or
  `super_admin`. The seed now reads `SEED_USER_PASSWORD` / `SEED_ADMIN_PASSWORD` (`||`, so an empty value can never
  become an empty password; dev and CI keep the old defaults), generated on the box into the untracked `.env.local`.
  Judges get credentials only on request, out of band; the passwords are rotated or the box torn down after judging.
  The seed prints raw API keys, so its output is never kept: this file holds only smoke and demo output.
- **HTTPS:** `COOKIE_SECURE=true` needs HTTPS; over plain HTTP the session cookie is dropped and login fails. Decided
  at deploy time: HTTPS (preferred), or `COOKIE_SECURE=false` recorded here as a demo setting.

## Evidence (filled in after the deploy)
| Item | Value |
|---|---|
| Public URL | |
| Commit deployed | |
| Deployed at (Asia/Bahrain) | |
| `schema_migrations` count | |
| `ops/smoke.sh` output | |
| `ops/demo.sh` (hosted mode) output | |
