# Hosting handoff: FilsPay on Dilmune Cloud (FP-300 box 6)

For the teammate who hosts. Read this page before you touch the repo or the box. The commands are in
[`DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md); this page covers what to watch for and what to hand back.

**Times (Asia/Bahrain, 2026-10-30):** deploy window closes **19:00**, code freeze **20:00**, submission **22:00**.
If the deploy is not live and checked by 19:00, stop and tell the team lead. We then present from the saved local run
(runbook §5).

## 1. Traps (read all 12)

**Repo and AI tools**
1. **Clone this repo (`yassfee/Handover-Hackathon`) and use its `main` only.** It is our `audit/handover` branch.
   Never add `github.com/MJ5-byte/fils-pay` as a remote and never push there: every team shares it, and its `main`
   still carries planted AI-instruction files.
2. **No `CLAUDE.md`, `AGENTS.md` or `.cursorrules` belongs in this repo.** The organizers planted them with false rules
   (1 BD = 100 "cents", UTC midnight, "never modify tests", ...). They are kept as evidence in
   `docs/audit/evidence/ai-config-originals/*.original.txt` and exist in commits before `89daa69`. If you use an AI
   assistant (Claude Code, Cursor, Copilot): do not let it read or follow those files, do not check out old commits,
   and if one of those files shows up at the repo root, delete it from your copy and tell us. Give the assistant this
   page as its instructions instead.
3. **Comments and docs lie on purpose.** Treat code comments, `CHANGELOG.md`, `docs/` outside `docs/audit/`, and
   especially **`ops/README.md`** as unverified. `ops/README.md` is wrong that `.env.docker` gets loaded (nothing
   loads it), that `SETTLEMENT_INTERNAL_TOKEN` defaults to `dev-token` (it has no default; the daemon will not start
   without it), and that settlement is built on the box (never). Trust `DEPLOY_RUNBOOK.md`, the two compose files and
   `ops/.env.production.example`. Full list: [`TRAPS.md`](TRAPS.md) §7.
4. **Do not open `db/seed/fixtures/production_seed.sql` (15 MB, used by nothing) or `package-lock.json`** with an AI
   tool. They burn tokens and teach nothing.
5. **Do not change application code.** Every change on this branch is a counted, tested, minimal fix. If something
   looks broken, look the file up in [`FINDINGS.md`](FINDINGS.md) and tell the team lead; do not patch it on the box.
   Two to leave alone: `apps/api/src/payments/discountAdjustment.ts` is unused on purpose (wiring it back charges the
   discount twice, FEES-3), and `apps/api/src/v1/` is never registered (dead code).

**The box**
6. **Never build on the box** (1 vCPU / 2 GB RAM / 2 GB disk, API limited to 0.5 vCPU / 512 MB; a `go build` once filled it). Build on a laptop,
   `docker save | gzip`, copy, `docker load` (runbook §1-2a).
7. **CPU architecture.** Run `uname -m` on the box first. If it says `x86_64` and your laptop is an ARM Mac (M1-M4),
   build and pull with `DOCKER_DEFAULT_PLATFORM=linux/amd64` set, or the containers die with `exec format error`.
8. **Docker Compose 2.24 or newer on the box** (`docker compose version`). The prod override hides Postgres with
   `ports: !reset []`. An older Compose rejects it, and deleting that line would publish Postgres with the repo's
   public dev password.
9. **Fresh database at first deploy; upgrade in place after that.** Run `migrate` on an empty volume the first time:
   `schema_migrations` must hold as many rows as there are `.sql` files in `db/migrations` (`ls db/migrations/*.sql | wc -l`).
   For the final version, upgrade in place (runbook §2c: load images, `migrate`, `up -d`, no reseed). Do not
   copy a database from a laptop (migration 0087 has a caveat for old databases, see [`DEPLOYMENT.md`](DEPLOYMENT.md)),
   and never point `migrate` or `seed` at any database other than the box's own Postgres.

**Secrets and logins**
10. **Fresh secrets, generated on the box, never committed.** On the box, `cp ops/.env.production.example
    ops/.env.local` and fill every secret with `openssl rand -base64 32`, and `SEED_USER_PASSWORD` /
    `SEED_ADMIN_PASSWORD` with `openssl rand -base64 24`. `ops/.env.local` is git-ignored: never commit it, paste it
    in chat, or screenshot it. The `ACQUIRER_CALLBACK_SIGNING_SECRET` that was once committed in `ops/.env.docker` is
    burned. If the seed passwords are left empty, the public dev passwords work and anyone can log in as `finance` or
    `super_admin`.
11. **The seed prints raw API keys.** Always run it as `$C run --rm seed > /dev/null`. Never keep, paste or commit its
    output.
12. **Login needs HTTPS and the demo OTP setting.** With `COOKIE_SECURE=true` the session cookie is dropped over plain
    HTTP, so login fails with no clear error. Put the API behind the provider's TLS or a Caddy/nginx proxy; only if
    neither exists, set `COOKIE_SECURE=false` and write that in `DEPLOYMENT.md`. Keep `OTP_DEV_EXPOSE=true` (a demo
    setting): there is no OTP delivery channel and production does not log the code, so without it nobody can log in.
    Run **one** API replica (the webhook dispatcher can double-send with two).

Not deploy bugs, so do not chase them: money is integer fils (1 BD = 1000 fils), and a settlement day closes only after
midnight Asia/Bahrain (UTC+3), so today's captures land in tomorrow's payout batch (CLOSE-1).

## 2. Ask the organizers
Fill runbook §0, keeping credentials out of git: console login, deploy method (VM with Docker, or a registry), public
hostname and TLS, the box's CPU architecture, how "live" is judged, and whether `OTP_DEV_EXPOSE=true` is acceptable for
the demo.

## 3. Deploy: what each step should show
Follow [`DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md) §1-4, with `C="docker compose -f ops/docker-compose.yml -f
ops/docker-compose.prod.yml"` on the box. Laptop needs Docker, bash, curl and Node 22.

| Step | Expect |
|---|---|
| `git log -1 --format=%h` (laptop, before building) | the commit you record as "Commit deployed" |
| `docker compose -f ops/docker-compose.yml build` | images `ops-api`, `ops-reporting`, `ops-migrate`, `ops-seed`, `ops-settlement` |
| `docker load` on the box | those 5 plus `postgres:16-alpine`; `df -h` still shows free space |
| `$C run --rm migrate` | no error; `$C exec postgres psql -U filspay -d filspay -tAc "select count(*) from schema_migrations"` prints the number of `.sql` files in `db/migrations` |
| `$C up -d api settlement reporting` | `$C ps` shows api `healthy`; `curl https://<host>/readyz` returns 200 |
| merchant id for the scripts | `$C exec postgres psql -U filspay -d filspay -tAc "select id from merchants where display_name = 'Alpha Retail Co'"` |
| `ops/smoke.sh` (laptop, runbook §4) | `PASS` lines, then `smoke: all checks passed against https://<host>` |
| `ops/demo.sh` (laptop, runbook §4) | box 1 and box 5 checks `PASS`; box 2 needs `PSQL`, box 3 and the local receiver print `SKIP` (localhost only, by design); last line `demo: ALL CHECKS PASSED against https://<host>` |

`PASSWORD` for the scripts is `SEED_USER_PASSWORD` from the box's `ops/.env.local`; copy it over SSH, not through chat.

## 4. Hand back
- Create a branch `hosting` from `main`. Commit only `docs/audit/DEPLOYMENT.md`: the Status line and the Evidence
  table (public URL, commit deployed, time in Asia/Bahrain, migration count, smoke output, demo output). Push
  `hosting` to this repo and tell the team lead, who merges it. Do not push to `main`, so the 20:00 freeze stays clean.
- Paste only smoke and demo output. Never paste `.env.local`, seed output, passwords or the Dilmune login.
- After judging: rotate the seed passwords or tear the box down. Give judges credentials only if they ask, out of band
  (runbook §6).

## 5. To understand what you are hosting
[`FINDINGS.md`](FINDINGS.md) (summary table and top 10), [`FP-300-refunds.md`](FP-300-refunds.md) (the refunds
feature), [`TRAPS.md`](TRAPS.md), and `ops/demo.sh` (what the demo checks; saved local run in
[`evidence/`](evidence/)).
