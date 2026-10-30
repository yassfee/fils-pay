#!/usr/bin/env node
// FilsPay checkout load test. Node 22, no dependencies, no database access: HTTP only.
//
// Scenario, per virtual user (closed loop; THINK_MS pause between checkouts, default 0):
//   1. the merchant creates a payment link   POST /v1/merchants/:id/payment-links
//   2. the buyer opens the public link       GET  /v1/payment-links/:token
//   3. the buyer pays                        POST /v1/payment-links/:token/pay  (Idempotency-Key)
//   MODE=api instead runs POST /v1/transactions (API key) + POST /v1/transactions/:id/capture.
// A 503 (shed) is retried after Retry-After with the SAME Idempotency-Key, like a real client.
//
// Usage (from the repo root):
//   BASE_URL=https://host MERCHANT_ID=<uuid> EMAIL=<owner email> PASSWORD=<pw> node ops/loadtest.mjs
//   Login uses the OTP code from the login response (OTP_DEV_EXPOSE=true) or OTP_CODE=<code>.
//   API_KEY=<key> skips the login and authenticates link creation with the key (MODE=api needs it).
// Knobs: STEPS=5,10,20,40,80 (ramp, concurrent users per step)  STEP_SECONDS=30  PAUSE_SECONDS=3
//        MODE=confirm KNEE=<users> (one STEP_SECONDS step at the knee, default 60 s)
//        P95_MS=1000 (the knee's latency bound, applied to the pay call)  AMOUNT_FILS=1500
//        TIMEOUT_MS=15000  THINK_MS=0  VERIFY=1 (check every outcome over the API afterwards)  OUT=<file.json>
// Output: a markdown block to paste into docs/audit/CAPACITY.md, and the run tag for ops/loadtest-check.sql.

const env = process.env;
const BASE = (env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MODE = env.MODE ?? "ramp";
const STEPS = MODE === "confirm" ? [Number(env.KNEE)] : (env.STEPS ?? "5,10,20,40,80").split(",").map(Number);
const STEP_MS = Number(env.STEP_SECONDS ?? (MODE === "confirm" ? 60 : 30)) * 1000;
const PAUSE_MS = Number(env.PAUSE_SECONDS ?? 3) * 1000;
const P95_MS = Number(env.P95_MS ?? 1000);
const AMOUNT = Number(env.AMOUNT_FILS ?? 1500);
const TIMEOUT_MS = Number(env.TIMEOUT_MS ?? 15000);
const THINK_MS = Number(env.THINK_MS ?? 0);
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const RUN = `lt-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
if (STEPS.some((s) => !(s > 0))) throw new Error("STEPS / KNEE must be positive integers");

let auth = {}; // headers that authenticate the merchant
const samples = []; // { step, kind, status, ms }
const checkouts = []; // { step, ok, ms, token, txId, key, outcome }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(step, kind, method, path, body, headers = {}) {
  const t0 = performance.now();
  let status = 0, json = null, retryAfter = 1;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    retryAfter = Number(res.headers.get("retry-after") ?? 1) || 1;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch {
    status = 0; // timeout or network error
  }
  const ms = performance.now() - t0;
  if (step !== null) samples.push({ step, kind, status, ms });
  if (status === 0) await sleep(1000); // refused or timed out (e.g. the API is restarting): back off like a client
  return { status, json, retryAfter };
}

// 503 = shed before any write: retry the same request (same Idempotency-Key) after Retry-After, at most 5 times.
async function callRetry(step, kind, method, path, body, headers) {
  let r;
  for (let i = 0; i < 6; i++) {
    r = await call(step, kind, method, path, body, headers);
    if (r.status !== 503) return r;
    await sleep(r.retryAfter * 1000 * (0.5 + Math.random()));
  }
  return r;
}

async function login() {
  if (env.API_KEY) { auth = { authorization: `Bearer ${env.API_KEY}` }; return; }
  for (const k of ["MERCHANT_ID", "EMAIL", "PASSWORD"]) if (!env[k]) throw new Error(`${k} is required (or API_KEY)`);
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchantId: env.MERCHANT_ID, email: env.EMAIL, password: env.PASSWORD }),
  });
  const jar = new Map();
  const keep = (r) => r.headers.getSetCookie().forEach((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); });
  keep(res);
  const body = await res.json();
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  const code = env.OTP_CODE ?? body.devOtpCode;
  if (!code) throw new Error("no OTP code: set OTP_CODE=<code> (the login response does not expose it)");
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const v = await fetch(`${BASE}/v1/auth/otp/verify`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookie() }, body: JSON.stringify({ code: String(code) }),
  });
  keep(v);
  if (v.status !== 200) throw new Error(`OTP verify failed: ${v.status}`);
  auth = { cookie: cookie() };
}

async function checkoutLink(step, n) {
  const t0 = performance.now();
  const c = { step, ok: false, ms: 0, token: null, txId: null, key: crypto.randomUUID(), outcome: "create_failed" };
  checkouts.push(c);
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const created = await callRetry(step, "create", "POST", `/v1/merchants/${env.MERCHANT_ID}/payment-links`,
    { amountFils: AMOUNT, reference: `${RUN}-${step}-${n}`, expiresAt }, auth);
  if (created.status !== 201) { c.outcome = `create_${created.status}`; return; }
  c.token = created.json.token;
  const viewed = await callRetry(step, "view", "GET", `/v1/payment-links/${c.token}`);
  if (viewed.status !== 200) { c.outcome = `view_${viewed.status}`; return; }
  const paid = await callRetry(step, "pay", "POST", `/v1/payment-links/${c.token}/pay`, { card: CARD }, { "idempotency-key": c.key });
  c.ms = performance.now() - t0;
  c.outcome = paid.status === 200 ? "paid" : `pay_${paid.status}`;
  if (paid.status === 200) { c.ok = true; c.txId = paid.json.transactionId; }
}

async function checkoutApi(step, n) {
  const t0 = performance.now();
  const c = { step, ok: false, ms: 0, token: null, txId: null, key: crypto.randomUUID(), outcome: "authorize_failed" };
  checkouts.push(c);
  const a = await callRetry(step, "authorize", "POST", "/v1/transactions",
    { amountFils: AMOUNT, card: CARD, reference: `${RUN}-${step}-${n}` }, { ...auth, "idempotency-key": `${c.key}:a` });
  if (a.status !== 201) { c.outcome = `authorize_${a.status}`; return; }
  c.txId = a.json.id;
  const k = await callRetry(step, "capture", "POST", `/v1/transactions/${c.txId}/capture`, {}, { ...auth, "idempotency-key": `${c.key}:c` });
  c.ms = performance.now() - t0;
  c.outcome = k.status === 200 ? "paid" : `capture_${k.status}`;
  c.ok = k.status === 200;
}

async function runStep(step) {
  const end = Date.now() + STEP_MS;
  const t0 = performance.now();
  let n = 0;
  const vu = async () => {
    while (Date.now() < end) {
      await (MODE === "api" ? checkoutApi : checkoutLink)(step, n++);
      if (THINK_MS) await sleep(THINK_MS);
    }
  };
  await Promise.all(Array.from({ length: step }, vu));
  return (performance.now() - t0) / 1000;
}

const pct = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const f0 = (x) => (Number.isFinite(x) ? Math.round(x) : "-");
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");

async function verify() {
  // Over the API only. Ledger legs and the outbox need SQL: ops/loadtest-check.sql.
  const out = { clientPaid: 0, capturedOk: 0, capturedBad: 0, unseenPaid: 0, notCharged: 0, reserved: 0, retryProbe: 0, retryProbeBad: 0 };
  const todo = [...checkouts];
  const worker = async () => {
    for (let c; (c = todo.pop()); ) {
      if (c.ok) {
        out.clientPaid++;
        const r = await call(null, "verify", "GET", `/v1/transactions/${c.txId}`, null, auth);
        if (r.status === 200 && r.json.status === "captured" && r.json.capturedFils === AMOUNT) out.capturedOk++;
        else out.capturedBad++;
        if (MODE !== "api" && out.retryProbe < 25) { // a retried pay must never charge again
          out.retryProbe++;
          const again = await call(null, "verify", "POST", `/v1/payment-links/${c.token}/pay`, { card: CARD }, { "idempotency-key": c.key });
          if (again.status === 200 && again.json?.transactionId !== c.txId) out.retryProbeBad++;
        }
      } else if (c.token) {
        const r = await call(null, "verify", "GET", `/v1/payment-links/${c.token}`);
        if (r.json?.status === "paid") out.unseenPaid++;
        else if (r.json?.status === "reserved") out.reserved++;
        else out.notCharged++;
      } else out.notCharged++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

await login();
const health = await call(null, "health", "GET", "/healthz");
if (health.status !== 200) throw new Error(`healthz returned ${health.status}`);
console.error(`run ${RUN}: ${BASE} mode=${MODE} steps=${STEPS.join(",")} step=${STEP_MS / 1000}s`);
const rows = [];
for (const step of STEPS) {
  const secs = await runStep(step);
  const s = samples.filter((x) => x.step === step);
  const cs = checkouts.filter((x) => x.step === step);
  const payKind = MODE === "api" ? "capture" : "pay";
  const lat = s.filter((x) => x.status !== 503 && x.status !== 0).map((x) => x.ms);
  const pay = s.filter((x) => x.kind === payKind && x.status !== 503 && x.status !== 0).map((x) => x.ms);
  const row = {
    users: step, secs, requests: s.length, rps: s.length / secs, checkouts: cs.filter((c) => c.ok).length,
    cps: cs.filter((c) => c.ok).length / secs, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99),
    payP50: pct(pay, 50), payP95: pct(pay, 95), payP99: pct(pay, 99),
    e2eP95: pct(cs.filter((c) => c.ok).map((c) => c.ms), 95),
    shed: s.filter((x) => x.status === 503).length, shedP95: pct(s.filter((x) => x.status === 503).map((x) => x.ms), 95),
    e5xx: s.filter((x) => x.status >= 500 && x.status !== 503).length, timeouts: s.filter((x) => x.status === 0).length,
    e4xx: s.filter((x) => x.status >= 400 && x.status < 500).length, failed: cs.filter((c) => !c.ok).length,
  };
  rows.push(row);
  console.error(`users=${step} cps=${f1(row.cps)} p95=${f0(row.p95)} payP95=${f0(row.payP95)} shed=${row.shed} 5xx=${row.e5xx} timeouts=${row.timeouts}`);
  if (step !== STEPS.at(-1)) await sleep(PAUSE_MS);
}
const v = env.VERIFY === "0" ? null : await verify();
const good = rows.filter((r) => r.shed + r.e5xx + r.timeouts + r.failed === 0 && r.payP95 <= P95_MS);
const knee = good.length ? good.reduce((a, b) => (b.users > a.users ? b : a)) : null;

const lines = [
  `#### Load test ${RUN} (${MODE}) against ${BASE}`,
  "",
  `Scenario: ${MODE === "api" ? "authorize + capture (API key)" : "create link + open link + pay"}, ${AMOUNT} fils, ${STEP_MS / 1000} s per step, think time ${THINK_MS} ms. Latencies in ms; "all" excludes 503 sheds and timeouts.`,
  "",
  "| users | req/s | checkouts/s | all p50 | all p95 | all p99 | pay p50 | pay p95 | pay p99 | checkout p95 | 503 shed (p95 ms) | 5xx | timeouts | 4xx | failed checkouts |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.users} | ${f1(r.rps)} | ${f1(r.cps)} | ${f0(r.p50)} | ${f0(r.p95)} | ${f0(r.p99)} | ${f0(r.payP50)} | ${f0(r.payP95)} | ${f0(r.payP99)} | ${f0(r.e2eP95)} | ${r.shed} (${f0(r.shedP95)}) | ${r.e5xx} | ${r.timeouts} | ${r.e4xx} | ${r.failed} |`),
  "",
  `Knee (highest step with 0 sheds/5xx/timeouts/failed checkouts and pay p95 <= ${P95_MS} ms): ${knee ? `${knee.users} users, ${f1(knee.cps)} checkouts/s, ${f1(knee.rps)} req/s, pay p95 ${f0(knee.payP95)} ms` : "none"}`,
];
if (v) lines.push(
  "",
  `API checks: client saw ${v.clientPaid} paid; ${v.capturedOk} confirmed captured for the exact amount, ${v.capturedBad} not; ` +
  `${v.unseenPaid} paid without the client seeing it (timeouts, not lost); ${v.reserved} still reserved; ${v.notCharged} not charged; ` +
  `retry probe: ${v.retryProbe} paid checkouts re-sent with the same Idempotency-Key, ${v.retryProbeBad} charged again.`,
);
lines.push("", `SQL checks (on the box): docker compose ... exec -T postgres psql -U filspay -d filspay -v tag=${RUN} < ops/loadtest-check.sql`);
console.log(lines.join("\n"));
if (env.OUT) (await import("node:fs")).writeFileSync(env.OUT, JSON.stringify({ run: RUN, base: BASE, mode: MODE, rows, verify: v }, null, 2));
