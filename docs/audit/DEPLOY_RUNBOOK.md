# Dilmune Cloud deploy runbook (draft, ready before access arrives on 2026-10-30)

**Rule:** deploy only with the access details the organizers give, and only after the user says go. Never build on the
box (0.5 vCPU / 2 GB RAM / 2 GB disk; a `go build` once filled it).

## 0. Fill in when access arrives
| Item | Value |
|---|---|
| Console URL / login | (from organizers) |
| Deploy method | VM with docker compose · registry pull · other |
| Registry + credentials | |
| Public hostname / TLS | provider TLS · or a Caddy/nginx proxy we run |
| How "live" is judged | URL · health check · judge script · freeze time |

## 1. Build images off the box (laptop)
```
cd fils-pay
docker compose -f ops/docker-compose.yml build          # ops-api, ops-reporting, ops-migrate, ops-seed (one Node image), ops-settlement
docker save ops-api ops-reporting ops-migrate ops-seed ops-settlement postgres:16-alpine | gzip > filspay-images.tgz
```
The Node services share layers (566 MB on disk once), settlement is 20 MB, Postgres 16-alpine is about 400 MB:
roughly 1 GB of the 2 GB disk. Prune old images on the box before loading.

## 2a. VM with docker (most likely)
```
scp filspay-images.tgz ops/docker-compose.yml ops/docker-compose.prod.yml ops/.env.production.example ops/smoke.sh <box>:~/filspay/ops/
ssh <box>
cd ~/filspay && gunzip -c ops/filspay-images.tgz | docker load && rm ops/filspay-images.tgz
cp ops/.env.production.example ops/.env.local   # then fill every secret with: openssl rand -base64 32
                                                # and SEED_USER_PASSWORD / SEED_ADMIN_PASSWORD with: openssl rand -base64 24
C="docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml"
$C up -d postgres && $C run --rm migrate && $C run --rm seed > /dev/null && $C up -d api settlement reporting
#                                       the seed prints raw API keys: never keep or paste its output
docker system prune -f
```
Compose needs the repo layout only for `build:`; with the prod override every service uses a loaded image.
## 2b. Registry
`docker tag ops-api <registry>/filspay-api:<sha>` and so on, push from the laptop, and set `image:` in the override.

## 3. Production settings (ops/.env.production.example)
NODE_ENV=production (Secure cookies, required secrets), ACQUIRER_CALLBACK_REQUIRE_SIGNATURE=true, fresh
WEBHOOK_SECRET_ENCRYPTION_KEY / SETTLEMENT_INTERNAL_TOKEN / ACQUIRER_CALLBACK_SIGNING_SECRET, COOKIE_SECURE=true behind
HTTPS, OTP_DEV_EXPOSE=true **for the demo only** (no OTP delivery exists; ask the organizers if that is acceptable).
Postgres is not published (prod override); the API is capped at 512 MB and has a health check.

**Seed logins.** The dev seed passwords in `db/seed/generate.ts` are public (every team has this repo) and
`OTP_DEV_EXPOSE=true` makes the OTP step no barrier, so the hosted box must be seeded with `SEED_USER_PASSWORD` and
`SEED_ADMIN_PASSWORD` from `ops/.env.local` (the prod override passes that file to the seed job). An empty value falls
back to the public ones; step 4's login with the new password proves the override took effect.

**HTTPS.** `COOKIE_SECURE=true` needs HTTPS in front of the api; over plain HTTP the session cookie is dropped and
login fails (step 4 shows it). Prefer the provider's TLS or a proxy. Only if neither exists, set `COOKIE_SECURE=false`
and record it in `docs/audit/DEPLOYMENT.md` as a demo setting.

## 4. Smoke test and demo (from the laptop)
```
P=<SEED_USER_PASSWORD from the box's ops/.env.local>
BASE_URL=https://<host> MERCHANT_ID=<Alpha Retail id> EMAIL=owner@alpharetail.example PASSWORD="$P" bash ops/smoke.sh
BASE_URL=https://<host> MERCHANT_ID=<Alpha Retail id> EMAIL=owner@alpharetail.example PASSWORD="$P" bash ops/demo.sh
```
Outside development there is no `devOtpCode`: pass `OTP_CODE=<code>` or type it when asked. Box 2 (ledger rows) needs
`PSQL`; Postgres is not published, so use the saved local run for box 2 (and box 3) unless the demo runs on the box.
Paste only the smoke and demo output into `docs/audit/DEPLOYMENT.md` (never seed output, never `.env.local`).

## 5. Fallback
If access is late or the box fails: the same compose stack locally (`LOCAL=1 bash ops/demo.sh`), the saved run in
`docs/audit/evidence/`, plus a screen recording of the demo.

## 6. After judging
Give judges credentials only on request and out of band. Rotate the seed passwords or tear the box down afterwards.
