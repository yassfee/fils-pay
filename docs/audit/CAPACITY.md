# Capacity and resilience (lane D, wave 3)

**Status: INTERIM.** Every number below was measured on a laptop under Docker CPU and memory limits that copy the
judged box. The figure we submit must come from the same test rerun on the box after the deploy (see "Rerun on the
box"). Until then, use the estimate with its margin.

**How these are credited.** CAP-2 (admission control) and CAP-4 (hot-path indexes) are **capacity work**: their notes carry `**Category:** Capacity work` and should be credited under the capacity criterion, not counted as bugs. CAP-6, the crash-safety defect this test found, is a bug and is filed under PL-1 as PL-1c.

## The box and the limits

| | Judged | Set where |
|---|---|---|
| Box | 1 vCPU / 2 GB RAM (2 GB disk) | the provider |
| API container | 0.5 vCPU / 512 MB | `ops/docker-compose.prod.yml`: `cpus: 0.5`, `mem_limit: 512m` |
| API heap | 384 MB V8 old space | `NODE_OPTIONS=--max-old-space-size=384`: V8 GCs hard, or exits and is restarted, before the cgroup OOM-kills it mid-request |
| API process | one `node --import tsx` process | prod `command:`. The base file's `npx tsx` runs three Node processes (npm exec about 78 MB, the tsx parent about 50 MB, the API) inside the same 512 MB |
| DB pool | API `PG_POOL_MAX=20`; settlement 5; reporting 5 | 30 of Postgres' default `max_connections=100` |
| Admission | `MAX_IN_FLIGHT=32` (code default 64): above it, 503 + `Retry-After: 1` before any handler runs (CAP-2) | `apps/api/src/app.ts`, prod override |
| Restart | `restart: unless-stopped` on postgres, api, settlement, reporting; `init: true` plus a health check that kills a wedged API (CAP-3) | prod override |
| Hot-path indexes | `ledger_entries(entry_group_id)`, `holds(transaction_id)`: before these, every checkout scanned both whole tables (CAP-4) | `db/migrations/0100_hot_path_indexes.sql` |
| Crash safety | the link is marked paid in the capture's own transaction (CAP-6, now filed as PL-1c under PL-1) | `paymentLinks/pay.ts`, `payments/capture.ts` |
| Web proxy (WEB-1) | Caddy serves the web and admin SPAs and fronts the API: `cpus: 0.25`, `mem_limit: 64m` (12-23 MiB used) | prod override. A cap, not a reservation, so idle headroom still goes to Postgres and the API. At 30 checkout users, Caddy at 0.1 vCPU was throttled in 223 of 582 scheduler periods: p99 1,239 ms vs 1,105 ms direct to the API, at the same rate (96.9 vs 101.4 req/s). At 0.25 it matched direct (p99 1,106 ms, 100.7 req/s). Judged requests pass through it, so 0.25. |

Why the pool matters: a checkout holds a pool connection for the whole authorize transaction and again for the whole
capture transaction, and each one includes the simulated acquirer call (`ACQUIRER_LATENCY_MIN_MS`/`MAX_MS`, 100-400
ms each by default). With the old default of 5 connections the API cannot finish more than about 5 / 0.6 s ≈ 8
checkouts/s, whatever the CPU. Those connections are idle in a transaction while the simulator sleeps, so 20 cost
Postgres memory (a few MB each) but almost no CPU.

## Method

- **Scenario** (`ops/loadtest.mjs`; Node 22, no dependencies, HTTP only). Each virtual user runs a closed loop with no
  think time: the merchant creates a payment link (`POST /v1/merchants/:id/payment-links`), the buyer opens it
  (`GET /v1/payment-links/:token`), and the buyer pays (`POST /v1/payment-links/:token/pay` with an Idempotency-Key).
  Each checkout is 1.5 BD (1500 fils), and one successful pay is one checkout.
  - A 503 is retried after `Retry-After` with the same Idempotency-Key, at most 5 times. After that the checkout
    counts as failed, but not charged.
  - `MODE=api` runs `POST /v1/transactions` plus `/capture` with an API key instead.
- **Login.** The script logs in once (password plus OTP) and every virtual user reuses that one session cookie.
  Alternatively it uses `API_KEY`. The checkout path itself needs no login: the public link read and pay are
  unauthenticated, and authorize and capture take an API key. Repeated logins as the same user are capped by design
  (AUTH-13 on main: 10 OTP challenges per user per 15 min, per account, never per IP). So a load test must never log
  in per user or per iteration.
- **Ramp.** Steps of N concurrent users, 30 s each, with a 3 s pause between steps. For each step the script records:
  - req/s and checkouts/s;
  - p50, p95 and p99 latency over all requests and over the pay call;
  - the end-to-end checkout p95;
  - 503 sheds (and their p95 latency), other 5xx, timeouts, 4xx and failed checkouts.
- **Knee.** The highest step with 0 sheds, 0 5xx, 0 timeouts, 0 failed checkouts and a pay p95 of at most 1000 ms.
  - The pay call always includes two simulated acquirer calls of 100-400 ms each (authorize and capture), so its
    p95 floor is about 750 ms even when idle.
  - A 500 ms p95 is met by the link create and read calls (p50 7 ms) but cannot be met by pay unless the simulator's
    latency is lowered. We did not lower it.
- **Correctness after each run.**
  - *Over the API* (built into the script, `VERIFY=1`; nothing needed on the box):
    - every checkout the client saw as paid is `GET /v1/transactions/:id` → `captured` for exactly 1500 fils;
    - every other link is classified by its public status (`paid` but unseen by the client, `reserved`, or not
      charged);
    - 25 paid checkouts are re-sent with the same Idempotency-Key and must not be charged again.
  - *Needs SQL on the box* (`ops/loadtest-check.sql`, read-only, run through `docker compose exec postgres psql`):
    - double captures per link;
    - paid links whose transaction is not captured for the link amount;
    - captured transactions with no paid link;
    - exactly one gross ledger pair per capture, for the captured amount;
    - debits = credits per transaction;
    - no ledger legs on uncaptured transactions;
    - exactly one `transaction.captured` outbox event per capture;
    - how far the reporting consumer lags.
- **Box emulation** (local, `docker compose -p capw3d ...` with a local-only override):
  - api 0.5 vCPU / 512 MB, exactly as judged (`cpus`, `mem_limit`, from the prod override);
  - Postgres 0.6 vCPU, reporting 0.07 and settlement 0.03, about 1.2 vCPU in total. At saturation the API used
    about 0.2-0.45 vCPU, so Postgres gets about 0.5-0.6 of the 1 vCPU on the real box. A second run gives Postgres
    0.4 vCPU as the pessimistic case.
  - The laptop is an Intel i7-9750H under Docker Desktop (WSL2). The load generator runs on the host, outside the
    limits.
  - Seeded with `npm run seed` (about 14k ledger rows), `ACQUIRER_FAILURE_RATE=0` and `NODE_ENV=production`, as in
    `ops/.env.production.example`.

## Results (local box emulation, interim)

Latencies are in ms. "all" covers every request except 503 sheds and timeouts. "pay" includes about 500 ms (mean) of
simulated acquirer time.

**Before CAP-4** (Postgres 0.6 vCPU, `MAX_IN_FLIGHT` effectively unlimited). Every checkout scanned the whole
ledger: Postgres was pinned at its CPU cap and `COMMIT` dominated `pg_stat_activity`.

| users | req/s | checkouts/s | all p95 | pay p95 | 5xx / timeouts |
|---:|---:|---:|---:|---:|---:|
| 10 | 42.6 | 14.2 | 817 | 971 | 0 / 0 |
| 20 | 49.6 | 16.5 | 1311 | 1488 | 0 / 0 |
| 30 | 41.7 | 13.9 | 2194 | 2500 | 0 / 0 |

**After CAP-4, ramp** (`lt-20261030140349`: Postgres 0.6 vCPU, cap lifted to 200 so the raw curve is visible):

| users | req/s | checkouts/s | all p50 | all p95 | all p99 | pay p50 | pay p95 | pay p99 | checkout p95 | 503 | 5xx | timeouts | failed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 26.7 | 8.9 | 7 | 687 | 765 | 542 | 749 | 814 | 761 | 0 | 0 | 0 | 0 |
| 10 | 52.9 | 17.6 | 7 | 682 | 762 | 537 | 749 | 804 | 767 | 0 | 0 | 0 | 0 |
| 20 | 74.0 | 24.7 | 64 | 915 | 1264 | 708 | 1106 | 1468 | 1287 | 0 | 0 | 0 | 0 |
| 30 | 83.6 | 27.9 | 102 | 1171 | 1595 | 824 | 1418 | 1883 | 1692 | 0 | 0 | 0 | 0 |
| 40 | 73.0 | 24.3 | 210 | 1584 | 1928 | 1210 | 1834 | 2037 | 2330 | 0 | 0 | 0 | 0 |
| 60 | 78.5 | 26.2 | 354 | 2095 | 2433 | 1678 | 2325 | 2585 | 3028 | 0 | 0 | 0 | 0 |

- All 4,036 paid checkouts were confirmed captured for 1500 fils over the API.
- Re-sending a paid checkout with the same Idempotency-Key charged nothing (25 of 25).
- At saturation the API used about 0.40-0.45 vCPU (of 0.5) and 70-80 MB of RAM; Postgres used 0.5-0.6 vCPU (of 0.6).
- Throughput stops growing at about 20-30 users in flight. Past that, extra concurrency only adds latency, so
  `MAX_IN_FLIGHT` is set to 32.

**Confirmation at the knee** (`lt-20261030141307`: 15 users, 60 s, Postgres 0.6 vCPU, final config):

| users | req/s | checkouts/s | all p50 | all p95 | all p99 | pay p50 | pay p95 | pay p99 | checkout p95 | 503 | 5xx | timeouts | failed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 15 | 67.6 | 22.5 | 9 | 764 | 1011 | 589 | 906 | 1304 | 1000 | 0 | 0 | 0 | 0 |

All 1,411 paid checkouts were confirmed captured, and the retry probe charged nothing.

**Pessimistic: Postgres 0.4 vCPU** (`lt-20261030141421`, final config, cap 32):

| users | req/s | checkouts/s | all p50 | all p95 | all p99 | pay p50 | pay p95 | pay p99 | checkout p95 | 503 | 5xx | timeouts | failed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 26.8 | 8.9 | 7 | 679 | 760 | 539 | 752 | 786 | 766 | 0 | 0 | 0 | 0 |
| 10 | 45.8 | 15.3 | 8 | 794 | 987 | 592 | 912 | 1177 | 1001 | 0 | 0 | 0 | 0 |
| 15 | 53.0 | 17.7 | 83 | 982 | 1576 | 715 | 1202 | 1897 | 1386 | 0 | 0 | 0 | 0 |
| 20 | 48.5 | 16.2 | 100 | 1399 | 1600 | 1094 | 1588 | 1699 | 1708 | 0 | 0 | 0 | 0 |
| 30 | 68.7 | 22.9 | 184 | 1251 | 1412 | 1088 | 1398 | 1609 | 1696 | 0 | 0 | 0 | 0 |

The knee here is 10 users at 15.3 checkouts/s (pay p95 912 ms). All 2,494 paid checkouts were confirmed captured.
The 20 and 30 user steps are noisy, which is normal with a laptop and Docker Desktop.

**API-key path** (`MODE=api`, `lt-20261030142129`: authorize + capture, Postgres 0.6 vCPU; the "pay" columns are the
capture call):

| users | req/s | checkouts/s | all p50 | all p95 | all p99 | capture p50 | capture p95 | capture p99 | checkout p95 | 503 | 5xx | timeouts | failed |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 36.2 | 18.1 | 274 | 412 | 481 | 281 | 416 | 480 | 762 | 0 | 0 | 0 | 0 |
| 20 | 54.9 | 27.5 | 345 | 615 | 822 | 358 | 702 | 991 | 1197 | 0 | 0 | 0 | 0 |

Each call carries one simulated acquirer delay, so at 10 users every request is under 500 ms at p95. All 1,391
captures were confirmed.

**SQL checks per run** (`ops/loadtest-check.sql`, each under 1 s). The columns are: links, paid, reserved,
transactions, captured, authorized only, outbox behind; then double captures, paid but not captured, captured but
link unpaid, wrong gross legs, unbalanced, legs on uncaptured, outbox not exactly one.

| run | first block | second block (must be all 0) |
|---|---|---|
| ramp after CAP-4 `lt-20261030140349` | 4036 4036 0 4036 4036 0 0 | 0 0 0 0 0 0 0 |
| knee confirm `lt-20261030141307` | 1411 1411 0 1411 1411 0 0 | 0 0 0 0 0 0 0 |
| pessimistic `lt-20261030141421` | 2494 2494 0 2494 2494 0 0 | 0 0 0 0 0 0 0 |
| API mode `lt-20261030142129` | 0 0 0 1391 1391 0 0 | 0 0 0 0 0 0 0 |
| overload + kill, before CAP-6 `lt-20261030140945` | 2298 2214 27 2234 2217 17 0 | 0 0 **3** 0 0 0 0 |
| overload + kill, after CAP-6 `lt-20261030141817` | 1975 1902 16 1908 1902 6 0 | 0 0 0 0 0 0 0 |

## The knee and our estimate for the judges

- **Knee (measured, local):** 15 concurrent users with no think time, at 22.5 checkouts/s (67.6 req/s), with p95
  764 ms over all requests and 906 ms for pay, and 0 errors. At 20 users throughput is still 24.7 checkouts/s, but
  pay p95 crosses 1 s.
- **Estimate for 1 vCPU / 2 GB, API at 0.5 vCPU / 512 MB:** about **15 concurrent checkout users (no think time),
  about 20 checkouts/s, about 60 req/s**, with pay p95 under 1 s and the link create and read calls well under 500
  ms.
  - Throughput ceiling: about 25 checkouts/s.
  - API-key path (authorize + capture): about 20 users at 27 checkouts/s, with capture p95 0.7 s. At 10 users
    every request is under 500 ms at p95.
  - Margin: ±40%. In the pessimistic Postgres 0.4 vCPU case the knee is 10 users at 15 checkouts/s (table above).
  - With think time T seconds per checkout, the number of users served is about 20 × (T + 0.9). For example, about
    200 users each paying once every 10 s.
- **Why it could differ on the box.**
  - A cloud vCPU may be slower than this laptop's turbo-boosted core.
  - fsync latency on the provider's disk sets the commit cost.
  - The judges' network round trip adds to their measured latency but not to server load.
  - Postgres shares the 1 vCPU with the API instead of having a fixed 0.6.
  - Throughput is bounded by Postgres CPU (commits) first and the API's 0.5 vCPU second. Memory is far from any
    limit (API about 80 MB of 512 MB).
- **Not a capacity knob we turned:** the simulated acquirer latency (100-400 ms per call) is left at its default. Lowering
  `ACQUIRER_LATENCY_*` would shorten pay latency, but it would no longer model the acquirer, so we did not.

## Overload: turn away the excess, restart, recover

Final config: `MAX_IN_FLIGHT=32`, Postgres 0.6 vCPU. The test ran 30 users, then 60 users (2× and 4× the knee),
45 s each. In the middle of the 60-user step the API process was killed with `kill -9`.

| run | users | checkouts/s | all p95 | pay p95 | 503 shed (p95 ms) | 5xx | timeouts / refused | failed checkouts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| before CAP-6 (`lt-20261030140945`) | 30 | 23.9 | 1396 | 1620 | 0 | 0 | 0 | 0 |
| | 60 + kill -9 | 23.1 | 1203 | 1609 | 1121 (76) | 0 | 4523 | 4589 |
| after CAP-6 (`lt-20261030141817`) | 30 | 23.3 | 1390 | 1786 | 0 | 0 | 0 | 0 |
| | 60 + kill -9 | 17.7 | 1685 | 2112 | 1114 (159) | 0 | 237 | 309 |

The first run's script retried instantly on a refused connection. The second run backs off for 1 s, as a real
client would, so its timeout count is the realistic one.

- **Turns away the excess.** Past 32 requests in flight the API answers 503 with `Retry-After: 1` in 76-159 ms
  (p95), before any handler runs.
  - Throughput holds at its plateau instead of collapsing. Admitted requests stay at about 1.4-2.1 s p95 for pay.
  - There are no 5xx, and no pool timeouts.
  - A shed checkout is retried with the same Idempotency-Key. A checkout shed 6 times in a row counts as failed and
    is never charged.
- **Restarts itself.**
  - `kill -9` during load: `/healthz` answered 200 again after **5.3-6.3 s** (`restart: unless-stopped`, RestartCount
    +1).
  - A wedged process (SIGSTOP; it accepts TCP but never answers): the health check timed out 3 times, killed it,
    and Docker restarted it. `/healthz` answered 200 after **44.6 s** (CAP-3).
  - An OOM kill is the same SIGKILL path. A V8 heap-limit abort (384 MB) exits the process, and the restart policy
    brings it back.
- **Recovers without losing data.**
  - SQL after each run (`ops/loadtest-check.sql`): 0 double captures, 0 paid links without a matching capture, 0
    wrong or unbalanced ledger legs, 0 legs on uncaptured transactions, exactly 1 `transaction.captured` outbox event
    per capture, and the reporting consumer caught up (0 events behind).
  - Over the API, every checkout the client saw as paid is captured for the exact amount, and 25 retries with the same
    key charged nothing.
- **Found by this test and fixed: CAP-6** (filed as follow-up PL-1c in `findings/PL-1.md`: same root cause as PL-1). Before the fix, the kill left **3 captured transactions on links still
  `reserved`**. The capture had committed, but "link paid" had not, and each of those links could be paid a second
  time after the 60 s lease. After the fix, the same test shows `captured_link_unpaid` 0, and `links_paid` 1,902
  equals `captured` 1,902.
- **What a kill still leaves, by design.**
  - Requests cut before their capture commits leave the link `reserved` until the 60 s lease expires (16 links in the
    second run), and authorized-but-uncaptured transactions with their hold (6). No money moved for any of them.
  - Checkouts that committed while the client's connection dropped (5) show `paid` on the link, so a retry gets 409
    `already_paid`.

## Rerun on the box (hosting teammate)

Run this after the deploy, from a laptop: it needs Node 22 and no repository install. Use the owner login of a seeded
merchant. The script logs in once, and needs `OTP_DEV_EXPOSE=true` or an `OTP_CODE`.

```bash
# 1. ramp: copy the printed table into "Results"
BASE_URL=https://<box> MERCHANT_ID=<alpha retail uuid> EMAIL=owner@alpharetail.example PASSWORD=<SEED_USER_PASSWORD> \
  STEPS=5,10,15,20,30,40 STEP_SECONDS=30 node ops/loadtest.mjs | tee ramp-box.md
# 2. confirm at the knee the ramp printed (60 s): this is the number we submit
BASE_URL=... MERCHANT_ID=... EMAIL=... PASSWORD=... MODE=confirm KNEE=<users> node ops/loadtest.mjs | tee knee-box.md
# 3. SQL checks for each run tag the script printed (on the box; every count in the second block must be 0)
docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml exec -T postgres \
  psql -U filspay -d filspay -v tag=<run tag> < ops/loadtest-check.sql
```

- **Copy into this file:** the ramp table, the knee line, the API-check line and the SQL output. Then replace the
  interim estimate with "users = knee users, checkouts/s = knee checkouts/s" and drop the INTERIM label.
- **Tune the cap.** If the box's throughput is still rising at 30 users, raise `MAX_IN_FLIGHT` in
  `ops/docker-compose.prod.yml` to about 1.5× the users at the throughput peak, then rerun step 2. A change in the
  env var needs only `up -d api`, no rebuild.
- **Before the judging window.** Each run leaves its links and transactions in the database, tagged
  `lt-<timestamp>-*`, so run it before the window, not during it. A 6-step ramp takes about 4 minutes, plus the
  API checks.
- **Seed time.** `npm run seed` took about 15 minutes against a Postgres limited to 0.4 vCPU, because it runs
  `generate()` twice for its determinism check. Budget for that on the box.

## Reproduce locally (what produced the numbers above)

```bash
# untracked secrets: ops/.env.local from ops/.env.production.example, each value from `openssl rand -base64 32`
docker build -f ops/Dockerfile.node -t capw3d-node:latest .
# local-only override (not in the repo): api image capw3d-node, port 127.0.0.1:3100, postgres cpus 0.6 / 768m,
# reporting cpus 0.07, settlement cpus 0.03 (image ops-settlement)
DC="docker compose -p capw3d -f ops/docker-compose.yml -f ops/docker-compose.prod.yml -f capw3d.override.yml"
$DC up -d postgres && $DC run --rm migrate && $DC run --rm seed > /dev/null   # seed prints API keys: discard
$DC up -d --no-deps api reporting settlement
BASE_URL=http://127.0.0.1:3100 MERCHANT_ID=... EMAIL=owner@alpharetail.example PASSWORD=... node ops/loadtest.mjs
$DC down -v
```
