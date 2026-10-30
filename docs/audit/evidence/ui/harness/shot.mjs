// Evidence harness (not part of the repo). usage: node shot.mjs <before|after> <label> <scenario...>
// Drives headless Edge over the DevTools protocol (Node 22 global WebSocket, no dependencies).
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const [phase, label, ...which] = process.argv.slice(2);
const OUT = process.env.OUT_DIR || new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const WEB = "http://localhost:5287";
const ADMIN = "http://localhost:5288";
const ALPHA = "9972daab-2c86-459f-9d78-3fe1be4e3280";
// Seeded accounts on a local throwaway DB. Passwords come from the environment (the seed's dev values,
// db/seed/generate.ts); they are sent only in fetch bodies and never rendered on screen.
const MERCHANT = { merchantId: ALPHA, email: "owner@alpharetail.example", password: process.env.SEED_USER_PASSWORD };
const ADMIN_USER = { email: "superadmin@filspay.test", password: process.env.SEED_ADMIN_PASSWORD };

const ver = await (await fetch("http://127.0.0.1:9337/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}, sessionId) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage({ clock, width = 1280, height = 860, mobile = false } = {}) {
  const { browserContextId } = await send("Target.createBrowserContext", {});
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await s("Emulation.setTimezoneOverride", { timezoneId: "Asia/Bahrain" });
  if (clock) {
    await s("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const T = ${clock}; const R = Date; class D extends R { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } } window.Date = D; })();`,
    });
  }
  const page = {
    async goto(url, wait = 2000) { await s("Page.navigate", { url }); await sleep(wait); },
    async eval(expr) {
      const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async note(text) {
      await page.eval(`(() => { const d = document.createElement('div'); d.textContent = ${JSON.stringify(text)};
        d.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#111827;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:6px 10px;border-radius:6px;opacity:.93';
        document.body.appendChild(d); })()`);
    },
    async shot(name) {
      const { data } = await s("Page.captureScreenshot", { format: "png" });
      mkdirSync(OUT, { recursive: true });
      const file = `${OUT}/${name}-${phase}.png`;
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`saved ${name}-${phase}.png (${Math.round(Buffer.from(data, "base64").length / 1024)} KB)`);
    },
    async close() {
      await send("Target.closeTarget", { targetId });
      await send("Target.disposeBrowserContext", { browserContextId });
    },
  };
  return page;
}

const json = (o) => JSON.stringify(o);
async function merchantLogin(page, { otp = true } = {}) {
  await page.goto(`${WEB}/dashboard/login`);
  return page.eval(`(async () => {
    const h = { "content-type": "application/json" };
    const r = await fetch("/v1/auth/login", { method: "POST", headers: h, credentials: "include", body: ${json(json(MERCHANT))} });
    const b = await r.json();
    if (!${otp}) return "login " + r.status;
    const v = await fetch("/v1/auth/otp/verify", { method: "POST", headers: h, credentials: "include", body: JSON.stringify({ code: b.devOtpCode }) });
    return "login " + r.status + ", otp " + v.status;
  })()`);
}
async function adminLogin(page) {
  await page.goto(`${ADMIN}/login`);
  return page.eval(`(async () => {
    const h = { "content-type": "application/json" };
    const r = await fetch("/v1/admin/auth/login", { method: "POST", headers: h, credentials: "include", body: ${json(json(ADMIN_USER))} });
    const b = await r.json();
    const v = await fetch("/v1/admin/auth/otp/verify", { method: "POST", headers: h, credentials: "include", body: JSON.stringify({ code: b.devOtpCode }) });
    return "admin login " + r.status + ", otp " + v.status;
  })()`);
}
async function setDate(page, index, value) {
  await page.eval(`(() => { const el = document.querySelectorAll('input[type=date]')[${index}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${json(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

const scenarios = {

  async u4refund() {
    // Then, in the throwaway DB only: UPDATE refunds SET occurred_at = '2026-08-26T12:00:00+03:00' WHERE transaction_id = '<that txn>';
    // (a refund made today nets only after today's Bahrain close), then run u4admin and u4web.
    const p = await newPage();
    console.log(await merchantLogin(p));
    const r = await p.eval(`(async () => {
      const r = await fetch("/v1/refunds", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "idempotency-key": "u4-evidence-refund" },
        body: JSON.stringify({ transactionId: "fbb420df-e273-4e3a-87bf-574dbee87ec4", amountFils: 3333, reason: "U4 evidence" }) });
      return r.status + " " + (await r.text()).slice(0, 200);
    })()`);
    console.log("refund:", r);
    await p.close();
  },
  async u4admin() {
    const p = await newPage();
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/settlement`, 3000);
    await setDate(p, 0, "2026-08-26");
    await p.eval(`(() => { const el = document.querySelector('input[placeholder^="00000000"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, ${json(ALPHA)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await p.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Run batch').click()`);
    await sleep(5000);
    const row = await p.eval(`[...document.querySelectorAll('table tbody tr')].map(r => r.innerText.replace(/\s+/g, ' ')).join(' | ')`);
    console.log("run-batch result:", row);
    await p.eval(`document.querySelector('table')?.scrollIntoView({ block: 'center' })`);
    await p.note(`${label} · U4 · admin Settlement ops → Re-run a daily batch 2026-08-26 for Alpha Retail Co (a 3.333 BHD refund nets into it)`);
    await p.shot("admin-run-batch-refunds-netted");
    await p.goto(`${ADMIN}/merchants/${ALPHA}`, 3500);
    await p.eval(`(() => { const td = [...document.querySelectorAll('td')].find(d => d.textContent === '2026-08-26'); td?.closest('table')?.previousElementSibling?.scrollIntoView({ block: 'start' }); })()`);
    await sleep(300);
    await p.eval(`document.querySelectorAll('code').forEach(c => { if (/^fp_(test|live)_/.test(c.textContent)) c.textContent = 'fp_•••• (masked)'; })`);
    await p.note(`${label} · U4 · admin merchant page, settlement batches table (2026-08-26 row); API-key prefix masked by the harness`);
    await p.shot("admin-merchant-batches-refunds-netted");
    await p.close();
  },
  async u4web() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    const id = await p.eval(`(async () => { const r = await (await fetch("/v1/settlement/batches?limit=50", { credentials: "include" })).json();
      const list = r.batches ?? r; return (list.find(b => b.batchDate === "2026-08-26") || {}).id; })()`);
    console.log("batch id:", id);
    await p.goto(`${WEB}/dashboard/settlement/${id}`, 3500);
    await p.note(`${label} · U4 · merchant batch 2026-08-26: Gross − Fee − Refunds netted = Net payout`);
    await p.shot("dashboard-batch-refunds-netted");
    await p.close();
  },

  async paySuccess() {
    const pm = await newPage();
    console.log(await merchantLogin(pm));
    const token = await pm.eval(`(async () => {
      const r = await fetch("/v1/merchants/${ALPHA}/payment-links", { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountFils: 3250, reference: "UI-EVIDENCE-PAID", description: "Evidence: paid at checkout", expiresAt: new Date(Date.now() + 3600000).toISOString() }) });
      return (await r.json()).token;
    })()`);
    const p = await newPage();
    await p.goto(`${WEB}/pay/${token}`, 2500);
    await p.eval(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const inputs = [...document.querySelectorAll('form input')]; const vals = ["4242424242424242", "12", "2030", "123"];
      inputs.forEach((el, i) => { set.call(el, vals[i]); el.dispatchEvent(new Event('input', { bubbles: true })); });
      document.querySelector('form button[type=submit], form button').click(); })()`);
    await sleep(5000);
    await p.note(`${label} · CHECKOUT-PAIDAT · checkout success page after paying 3.250 BHD with a simulated test card`);
    await p.shot("checkout-success");
    await p.close();
    await pm.close();
  },
  async batchDetail() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    await p.goto(`${WEB}/dashboard/settlement/317d557d-aa82-47ab-a372-220e31701ef9`, 3500);
    await p.note(`${label} · BATCH-BAR · closed settlement batch (gross 7,326.913 BHD)`);
    await p.shot("dashboard-batch-detail");
    await p.close();
  },
  async banner() {
    const p = await newPage();
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/merchants/${ALPHA}`, 3000);
    await p.eval(`window.open = () => null`);
    await p.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'View as merchant').click()`);
    await sleep(2500);
    await p.eval(`window.scrollTo(0, 0)`);
    await p.note(`${label} · IMP-BANNER · admin console banner while a "view as merchant" grant is active`);
    await p.shot("admin-impersonation-banner");
    await p.close();
  },

  async negRefund() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    const id = await p.eval(`(async () => {
      const list = await (await fetch("/v1/transactions?status=refunded&status=partially_refunded&limit=1", { credentials: "include" })).json();
      if (list.transactions?.length) return list.transactions[0].id;
      const cap = await (await fetch("/v1/transactions?status=captured&limit=1", { credentials: "include" })).json();
      const t = cap.transactions[0];
      const r = await fetch("/v1/refunds", { method: "POST", credentials: "include", headers: { "content-type": "application/json", "idempotency-key": "ui-evidence-refund-" + t.id },
        body: JSON.stringify({ transactionId: t.id, amountFils: 1000, reason: "UI evidence partial refund" }) });
      return r.ok ? t.id : "refund failed " + r.status + " " + (await r.text());
    })()`);
    console.log("refunded txn:", id);
    await p.goto(`${WEB}/dashboard/transactions/${id}`, 3500);
    await p.note(`${label} · UI-NEG-1 · detail page of a partially refunded transaction (the refund event carries a negative amount)`);
    await p.shot("dashboard-refunded-txn");
    await p.close();
  },
  async mobile() {
    const pm = await newPage();
    console.log(await merchantLogin(pm));
    const link = await pm.eval(`(async () => {
      const r = await fetch("/v1/merchants/${ALPHA}/payment-links", { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountFils: 12500, reference: "UI-EVIDENCE-375", description: "Evidence: 375px checkout", expiresAt: new Date(Date.now() + 86400000).toISOString() }) });
      return (await r.json()).token;
    })()`);
    const cookies = (await pm.eval(`document.cookie`)) || "";
    const p = await newPage({ width: 375, height: 812, mobile: true });
    await p.goto(`${WEB}/pay/${link}`, 3000);
    const m1 = await p.eval(`(() => { const i = [...document.querySelectorAll('form input')].pop(); return { cvvRightEdgePx: Math.round(i.getBoundingClientRect().right), viewportPx: innerWidth, pageScrollWidthPx: document.documentElement.scrollWidth }; })()`);
    console.log("checkout-375 layout:", JSON.stringify(m1));
    await p.note(`${label} · CHECKOUT-375 · checkout on a 375 px screen: the page lays out ${m1.pageScrollWidthPx} px wide (CVV right edge at ${m1.cvvRightEdgePx} px)`);
    await p.shot("checkout-375");
    console.log(await merchantLogin(p));
    await p.goto(`${WEB}/dashboard/transactions`, 3500);
    const m2 = await p.eval(`({ viewportPx: innerWidth, pageScrollWidthPx: document.documentElement.scrollWidth, tableWidthPx: Math.round(document.querySelector('table').getBoundingClientRect().width) })`);
    console.log("table-375 layout:", JSON.stringify(m2));
    await p.note(`${label} · CHECKOUT-375 · transactions on a 375 px screen: the page lays out ${m2.pageScrollWidthPx} px wide (table ${m2.tableWidthPx} px)`);
    await p.shot("dashboard-table-375");
    const txn = await p.eval(`document.querySelector('table tbody tr:nth-child(2) a')?.getAttribute('href')`);
    await p.goto(`${WEB}${txn}`, 3000);
    const m3 = await p.eval(`({ viewportPx: innerWidth, pageScrollWidthPx: document.documentElement.scrollWidth })`);
    console.log("detail-375 layout:", JSON.stringify(m3));
    await p.note(`${label} · CHECKOUT-375 · transaction detail on a 375 px screen: the page lays out ${m3.pageScrollWidthPx} px wide`);
    await p.shot("dashboard-detail-375");
    await p.close();
    await pm.close();
  },
  async links() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    const made = await p.eval(`(async () => {
      const r = await fetch("/v1/merchants/${ALPHA}/payment-links", { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountFils: 2500, reference: "UI-EVIDENCE-EXPIRES", description: "Evidence: expires in 3 s", expiresAt: new Date(Date.now() + 3000).toISOString() }) });
      return (await r.json()).id;
    })()`);
    await sleep(4000);
    await p.goto(`${WEB}/dashboard/payment-links`, 3000);
    await p.note(`${label} · LINK-EXPIRED · payment-link list: UI-EVIDENCE-EXPIRES expired a few seconds ago`);
    await p.shot("dashboard-links-expired");
    await p.goto(`${WEB}/dashboard/payment-links/${made}`, 3000);
    await p.note(`${label} · LINK-EXPIRED · detail of the expired link`);
    await p.shot("dashboard-link-expired-detail");
    await p.close();
  },
  async recon() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    await p.goto(`${WEB}/dashboard/reconciliation`, 4000);
    await p.note(`${label} · RECON-REFUNDS · merchant reconciliation (default window)`);
    await p.shot("dashboard-reconciliation");
    await p.close();
  },
  async ui401() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    await p.goto(`${WEB}/dashboard/transactions`, 3000);
    // The session ends server-side (here: logged out from another tab).
    console.log("logout:", await p.eval(`fetch("/v1/auth/logout", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" }).then(r => r.status)`));
    await p.eval(`document.querySelector('input[type=checkbox]').click()`);
    await sleep(2500);
    const url = await p.eval(`location.href`);
    await p.note(`${label} · UI-401 · session ended in another tab, then a filter was clicked. Now at ${url}`);
    await p.shot("dashboard-401");
    await p.close();
  },
  async notFound() {
    const p = await newPage();
    await p.goto(`${WEB}/dashboard/no-such-page`, 2500);
    await p.note(`${label} · ROUTER-404 · merchant dashboard, unknown URL /dashboard/no-such-page`);
    await p.shot("web-unknown-url");
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/no-such-page`, 2500);
    await p.note(`${label} · ROUTER-404 · admin console, unknown URL /no-such-page`);
    await p.shot("admin-unknown-url");
    await p.close();
  },
  async dateFilter() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    await p.goto(`${WEB}/dashboard/transactions`, 3000);
    await setDate(p, 0, "2026-08-27");
    await sleep(1000);
    await setDate(p, 1, "2026-08-28");
    await sleep(2500);
    const sent = await p.eval(`performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/v1/transactions?')).pop()`);
    console.log("request:", decodeURIComponent(sent || ""));
    const rows = await p.eval(`[...document.querySelectorAll('table tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);
    console.log("rows:", JSON.stringify(rows));
    await p.note(`${label} · UI-DATE-1 · Transactions filtered From 2026-08-27 To 2026-08-28 (exclusive); times in Asia/Bahrain. Request: ${decodeURIComponent((sent || "").replace(/^.*\?/, "?"))}`);
    await p.shot("dashboard-date-filter");
    await p.close();
  },
  async settleDefault() {
    const p = await newPage({ clock: Date.parse("2026-10-29T22:30:00Z") });
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/settlement`, 3000);
    const v = await p.eval(`document.querySelector('input[type=date]')?.value`);
    console.log("default date:", v);
    await p.note(`${label} · UI-SETTLE-1 · browser clock pinned to 2026-10-30 01:30 Asia/Bahrain by the harness; yesterday's business date is 2026-10-29. Form default: ${v}`);
    await p.shot("admin-run-batch-default");
    await p.close();
  },
  async viewAs() {
    const p = await newPage();
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/merchants/${ALPHA}`, 3000);
    // Same-tab instead of a second tab, so the harness can capture where the button lands.
    await p.eval(`window.open = (u) => { setTimeout(() => location.assign(u), 300); return null; }`);
    await p.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'View as merchant').click()`);
    await sleep(5000);
    const url = await p.eval(`location.href`);
    console.log("landed on:", url);
    await p.note(`${label} · ADMIN-IMP-3 · admin console → Alpha Retail Co → "View as merchant". Landed on ${url}`);
    await p.shot("view-as-merchant");
    await p.close();
  },
  async fees() {
    const p = await newPage();
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/merchants/${ALPHA}`, 3000);
    const txt = await p.eval(`(() => { const dt = [...document.querySelectorAll('dt')].find(d => /negotiated rate/i.test(d.textContent)); dt?.scrollIntoView({ block: 'center' }); return dt ? dt.textContent + ': ' + dt.nextElementSibling?.textContent : null; })()`);
    console.log("fee:", txt);
    await sleep(300);
    await p.note(`${label} · FEES-4 · Alpha Retail Co has 225 bps in force since 2026-08-01 and a 245 bps period from 2026-03-01 that was entered later (backfill). Shown: ${txt}`);
    await p.shot("admin-fee-schedule");
    await p.close();
  },
  async runBatchBad() {
    const p = await newPage();
    console.log(await adminLogin(p));
    await p.goto(`${ADMIN}/settlement`, 2500);
    const r = await p.eval(`(async () => {
      const r = await fetch("/v1/admin/settlement/run-batch", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-02-30" }) });
      return r.status + " " + (await r.text());
    })()`);
    console.log("POST /v1/admin/settlement/run-batch {date: 2026-02-30} ->", r);
    appendFileSync(`${OUT}/api-evidence-${phase}.txt`, `[${label}] UI-SETTLE-1b POST /v1/admin/settlement/run-batch {"date":"2026-02-30"} -> ${r}
`);
    await p.close();
  },
  async preOtp() {
    const p = await newPage();
    console.log(await merchantLogin(p, { otp: false }));
    await p.goto(`${WEB}/dashboard/transactions`, 3500);
    const url = await p.eval(`location.href`);
    console.log("landed on:", url);
    await p.note(`${label} · AUTH-1 · password accepted, OTP never entered, then opened /dashboard/transactions. Landed on ${url}`);
    await p.shot("dashboard-pre-otp");
    await p.close();
  },
  async checkout() {
    const p = await newPage();
    console.log(await merchantLogin(p));
    const mk = async (expiresInMs, amountFils, reference) => p.eval(`(async () => {
      const r = await fetch("/v1/merchants/${ALPHA}/payment-links", { method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountFils: ${amountFils}, reference: ${json(reference)}, description: "Evidence: checkout", expiresAt: new Date(Date.now() + ${expiresInMs}).toISOString() }) });
      return { status: r.status, body: await r.json() };
    })()`);
    const open = await mk(3_600_000, 4755, "UI-EVIDENCE-OPEN");
    console.log("open link:", open.status);
    const expired = await mk(4000, 4750, "UI-EVIDENCE-EXPIRED");
    console.log("short link:", expired.status);
    const pc = await newPage();
    await pc.goto(`${WEB}/pay/${open.body.token}`, 3000);
    await pc.note(`${label} · checkout · open link for 4755 fils: shown as 4.755 BHD (integer fils, 3 decimals)`);
    await pc.shot("checkout-open");
    await sleep(4500);
    await pc.goto(`${WEB}/pay/${expired.body.token}`, 3000);
    const pay = await pc.eval(`(async () => {
      const r = await fetch("/v1/payment-links/${expired.body.token}/pay", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "ui-evidence-" + Date.now() },
        body: JSON.stringify({ submittedAt: new Date(Date.now() - 60000).toISOString(), card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } }) });
      return r.status + " " + (await r.text()).slice(0, 160);
    })()`);
    console.log("pay expired link with stale submittedAt:", pay);
    await pc.note(`${label} · checkout · expired link (PL-2 / FP-187). A direct pay call with a stale submittedAt now returns: ${pay}`);
    await pc.shot("checkout-expired");
    await pc.close();
    await p.close();
  },
};

for (const name of which) {
  try { await scenarios[name](); } catch (err) { console.log(`${name} FAILED: ${err.message}`); }
}
ws.close();
