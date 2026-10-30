### CAP-2 · Under overload the API queues every request until it times out instead of turning the excess away · Severity: High
**Category:** Capacity work

**What's wrong:** The API had no admission control. Every request that reached the socket was accepted and parked, either on the event loop or in the `pg` pool's wait queue (`max: PG_POOL_MAX`, waiting up to `PG_POOL_CONNECTION_TIMEOUT_MS` = 5 s). Past capacity, latency climbed for every caller at once. Requests then failed after seconds with a 500 (`timeout exceeded when trying to connect`) or a client timeout, and the backlog kept growing in memory inside a 512 MB container.

**Why it happens:** `buildApp` (`apps/api/src/app.ts`) registers no `onRequest` limit, and `@fastify/under-pressure` is not installed. A checkout holds a pool connection for the whole authorize or capture transaction, including the simulated acquirer call (100-400 ms each, `acquirer/simulator.ts`). So throughput is bounded at roughly `PG_POOL_MAX / ~0.6 s`, while admission is unbounded.

**What it breaks:** The judged overload test ("push past your limit and see whether your stack turns away the excess"). Without a cap, a load spike slows down every buyer, including those already within capacity. Failures arrive late, as 5xx after up to 5 s or as client timeouts, so a client cannot tell "rejected, nothing written" from "may have been charged". Memory grows with the backlog.

**Why it needed a fix:** Capacity and hosting are scored on staying fast and correct at the limit and on turning the excess away. A fast 503 with `Retry-After`, sent before any write, gives the client a definite "nothing happened, retry later". With the existing Idempotency-Key handling, a retried checkout cannot double-charge.

**Fix:** `apps/api/src/app.ts:49-56`, `apps/api/src/config.ts:16,202`
```diff
+  // CAP-2: past a global (never per-IP) in-flight cap, answer 503 before any handler, so before any write. /healthz is exempt.
+  let inFlight = 0;
+  app.addHook("onRequest", async (request, reply) => {
+    if (request.routeOptions.url === "/healthz") return;
+    if (inFlight >= config.maxInFlight) return reply.code(503).header("retry-after", "1").send({ error: "overloaded" });
+    inFlight++;
+    reply.raw.once("close", () => inFlight--);
+  });
```
`config.ts` adds `maxInFlight` (`MAX_IN_FLIGHT`, default 64). The hosted override sets 32 because throughput peaked at about 30 requests in flight (`docs/audit/CAPACITY.md`). `onRequest` is the first hook in Fastify's lifecycle. It runs before body parsing, before preHandlers (auth) and before the route handler, so a shed request never touches the database. The counter is decremented on the raw response's `close` event, which Node emits once for every response: finished, errored or aborted by the client. A disconnecting client therefore cannot leak a slot. `/healthz` (liveness) is exempt, so the container's health check does not see a saturated API as dead. `/readyz` is not exempt, so it returns 503 while the API is saturated. That is a meaningful readiness signal for a load balancer.

**Why this is the smallest correct fix:** One hook at the single entry point that every route passes through. *Why not `@fastify/under-pressure`?* It is not installed (no new dependencies), and event-loop-delay shedding reacts late here: the bottleneck is the pool queue, not CPU. *Why not shrink the pool queue (`connectionTimeoutMillis`)?* That rejects requests in the middle of a handler, after auth and possibly after earlier writes in a multi-step checkout (link reserved, authorization written). The client then gets a 500, not a clean 503. *Why not a per-IP rate limit?* The graders load-test from a few IPs, and a per-IP limit would turn away legitimate users without protecting capacity. *Why not a queue with a wait timeout?* More code, and a shed request should be answered at once.

**Proof:** `CAP-2: requests over MAX_IN_FLIGHT get 503 + Retry-After before the handler runs; /healthz is never shed` (`apps/api/src/app.shed.audit.test.ts`), with `MAX_IN_FLIGHT=1` and a test route that blocks on a gate:
- Before the fix, the second request was admitted and blocked inside the handler. The test's 2 s abort fired (`not ok 1`).
- After the fix, the second request gets `503`, `retry-after: 1` and `{"error":"overloaded"}`, and the handler ran only once. `/healthz` still answers 200 while the API is saturated, and once the first request completes the next one is admitted (200).
- Under real load (0.5 vCPU / 512 MB), see `docs/audit/CAPACITY.md`: the 503s are answered in milliseconds, and the SQL and API checks after the overload run show no lost or doubled capture.

**Regression risk:** At most `MAX_IN_FLIGHT` requests are processed concurrently. Below the cap nothing changes. The cap is per process, and the box runs a single replica. Fastify `inject` emits `close` as well, so route tests are unaffected: `src/app.test.ts` and `paymentLinks/pay.test.ts` pass, and `tsc --noEmit` is clean.

Lines: prod +11/-0, test +58/-0
