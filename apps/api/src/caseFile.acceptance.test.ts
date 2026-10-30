/**
 * Case-file acceptance scenarios (handoff case file, pages 2-4): one end-to-end test per item,
 * written from the organizers' wording, not from the fix's own test. Each test builds its own
 * merchants (random ids), asserts on that merchant's rows only, uses no real sleeps and no
 * wall-clock boundary. Runs via app.inject against a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { issueApiKey } from "./apiKeys/issue.js";
import { recordKycReview } from "./onboarding/review.js";
import { hashPassword } from "./adminAuth/passwords.js";
import { createAcquirerSimulator } from "./acquirer/simulator.js";
import type { AcquirerSimulator } from "./acquirer/types.js";
import { payPaymentLink } from "./paymentLinks/pay.js";
import { runDispatchPass } from "./webhooks/dispatcher.js";
import type { WebhookTransportRequest } from "./webhooks/transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("caseFile.acceptance.test.ts requires DATABASE_URL (a migrated Postgres)");

const ACQUIRER_SECRET = "acqsec_case_file_acceptance";
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  INTERNAL_API_TOKEN: "test-internal-token",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  ACQUIRER_CALLBACK_SIGNING_SECRET: ACQUIRER_SECRET,
  PAYMENT_LINK_RESERVATION_TIMEOUT_SECONDS: "60",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const sent: WebhookTransportRequest[] = [];
const app = buildApp(config, pool, {
  webhookTransport: async (req) => {
    sent.push(req);
    return { statusCode: 200, body: "ok" };
  },
});

test.after(async () => {
  await app.close();
  await pool.end();
});

const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

// ---------- fixtures ----------

async function approvedMerchant(label: string, mdrBps = 250) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Case File ${label} ${randomUUID()}`, mdrBps],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey, id: keyId } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label });
  return { merchantId, keyId: keyId as string, headers: { authorization: `Bearer ${rawKey}` } };
}

async function capture(headers: Record<string, string>, amountFils: number, captureFils?: number) {
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils, card: CARD, reference: "case-file" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  const cap = await app.inject({
    method: "POST",
    url: `/v1/transactions/${transactionId}/capture`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: captureFils === undefined ? {} : { amountFils: captureFils },
  });
  assert.equal(cap.statusCode, 200, cap.body);
  return transactionId;
}

function refund(headers: Record<string, string>, transactionId: string, amountFils: number) {
  return app.inject({
    method: "POST",
    url: "/v1/refunds",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { transactionId, amountFils, reason: "customer_request" },
  });
}

async function createLink(headers: Record<string, string>, merchantId: string, amountFils = 4_750) {
  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers,
    payload: { amountFils, reference: "case-file", description: "Case file", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; token: string };
}

/** Sum of a merchant's ledger rows for one account, credit positive. */
async function net(merchantId: string, account: string, transactionId?: string): Promise<number> {
  const r = await pool.query<{ n: string | null }>(
    `SELECT SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END)::text AS n
       FROM ledger_entries WHERE merchant_id = $1 AND account_id = $2 AND ($3::uuid IS NULL OR transaction_id = $3)`,
    [merchantId, account, transactionId ?? null],
  );
  return Number(r.rows[0]!.n ?? 0);
}

function cookieOf(setCookie: string | string[] | undefined, name?: string): string {
  const all = Array.isArray(setCookie) ? setCookie : [setCookie];
  const hit = all.find((h) => h && (name === undefined || h.startsWith(`${name}=`)));
  if (!hit) throw new Error(`expected a Set-Cookie header${name ? ` for ${name}` : ""}`);
  return hit.split(";")[0]!;
}

const ADMIN_PASSWORD = "case-file-admin-password-9000!";
let adminHash: string | null = null;
async function signedInAdmin(role: "support" | "finance" | "super_admin") {
  adminHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `case-file-${randomUUID()}@admin.test`;
  await pool.query(`INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`, [
    email,
    adminHash,
    `Case file ${role}`,
    role,
  ]);
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: ADMIN_PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = cookieOf(login.headers["set-cookie"], config.adminCookieName);
  const verify = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    headers: { cookie },
    payload: { code: (login.json() as { devOtpCode: string }).devOtpCode },
  });
  assert.equal(verify.statusCode, 200, verify.body);
  return { cookie };
}

async function signupAndLogin() {
  const email = `case-file-${randomUUID()}@example.test`;
  const password = "correct horse battery staple 1!";
  const signup = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Case File Co ${randomUUID()}`,
        registrationNumber: `RC-${randomUUID().slice(0, 8)}`,
        businessType: "llc",
        contactEmail: `contact-${randomUUID()}@example.test`,
        contactPhone: "+97300000000",
        addressLine1: "1 Test Street",
        city: "Manama",
      },
      owner: { email, password },
    },
  });
  assert.equal(signup.statusCode, 201, signup.body);
  const merchantId = (signup.json() as { merchantId: string }).merchantId;
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const body = login.json() as { otpRequired: boolean; devOtpCode: string };
  return { merchantId, pendingCookie: cookieOf(login.headers["set-cookie"]), otp: body.devOtpCode, otpRequired: body.otpRequired };
}

// ---------- Page 3: Finance & Ops ----------

test("F6: the dashboard fee shows a later-entered backfill rate (245 bps) while payments go through at 225 bps, now it shows the rate actually charged", async () => {
  const { merchantId, headers } = await approvedMerchant("f6", 300);
  // The schedule in force (225 bps) was entered first; a backfill fix for an older period (245 bps) was entered later.
  await pool.query(
    `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from, created_at) VALUES
       ($1, 225, now() - interval '30 days', now() - interval '1 day'),
       ($1, 245, now() - interval '400 days', now())`,
    [merchantId],
  );
  const txn = await capture(headers, 100_000);
  assert.equal(await net(merchantId, "platform_fee_revenue", txn), 2_250, "the payment is charged at 225 bps");

  const admin = await signedInAdmin("support");
  const res = await app.inject({ method: "GET", url: `/v1/admin/merchants/${merchantId}`, headers: { cookie: admin.cookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { currentFeeSchedule: { mdrBps: number } }).currentFeeSchedule.mdrBps, 225);
});

test("F7: a CSV import of 4.755 BD lands as 4.750 and 4.75 BD as 0.475, now the ledger shows 4,755 and 4,750 fils", async () => {
  const admin = await signedInAdmin("finance");
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode) VALUES ($1, 250, 'active', false) RETURNING id`,
    [`Case File f7 ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/adjustment-imports",
    headers: { cookie: admin.cookie },
    payload: {
      csvContent: `merchantId,amount,reason\n${merchantId},4.755,statement correction\n${merchantId},4.75,statement correction\n`,
      originalFilename: "f7.csv",
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal((res.json() as { totalPostedFils: number }).totalPostedFils, 9_505);
  const legs = await pool.query<{ amount_fils: string }>(
    `SELECT amount_fils::text FROM ledger_entries
      WHERE merchant_id = $1 AND account_id = 'merchant_payable' AND direction = 'credit' ORDER BY id`,
    [merchantId],
  );
  assert.deepEqual(legs.rows.map((r) => Number(r.amount_fils)), [4_755, 4_750]);
});

test("G4: login works without entering the OTP code, now a password-only (pending) session is refused until the OTP is verified", async () => {
  const s = await signupAndLogin();
  assert.equal(s.otpRequired, true);
  for (const url of ["/v1/auth/me", "/v1/transactions"]) {
    const res = await app.inject({ method: "GET", url, headers: { cookie: s.pendingCookie } });
    assert.equal(res.statusCode, 401, `${url}: ${res.body}`);
  }
  const mint = await app.inject({
    method: "POST",
    url: `/v1/merchants/${s.merchantId}/api-keys`,
    headers: { cookie: s.pendingCookie },
    payload: { label: "no-otp" },
  });
  assert.equal(mint.statusCode, 401, mint.body);

  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: s.pendingCookie }, payload: { code: s.otp } });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = verify.headers["set-cookie"] ? cookieOf(verify.headers["set-cookie"]) : s.pendingCookie;
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
});

test("G5: merchant A could cancel merchant B's payment link from A's dashboard, now the cancel is refused and B's link stays payable", async () => {
  const a = await approvedMerchant("g5-a");
  const b = await approvedMerchant("g5-b");
  const link = await createLink(b.headers, b.merchantId);
  for (const url of [`/v1/merchants/${a.merchantId}/payment-links/${link.id}`, `/v1/merchants/${b.merchantId}/payment-links/${link.id}`]) {
    const res = await app.inject({ method: "DELETE", url, headers: a.headers });
    assert.ok([403, 404].includes(res.statusCode), `${url}: ${res.statusCode} ${res.body}`);
  }
  const row = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [link.id]);
  assert.equal(row.rows[0]!.status, "active");
  const pay = await app.inject({ method: "POST", url: `/v1/payment-links/${link.token}/pay`, headers: { "idempotency-key": randomUUID() }, payload: { card: CARD } });
  assert.equal(pay.statusCode, 200, pay.body);
});

// ---------- Page 4: tickets and incidents ----------

test("FP-187: a link that shows 'expired' still took a payment because the server trusted the checkout's submittedAt, now it is refused and nothing is charged", async () => {
  const { merchantId, headers } = await approvedMerchant("fp187");
  const link = await createLink(headers, merchantId);
  await pool.query(`UPDATE payment_links SET expires_at = now() - interval '1 minute' WHERE id = $1`, [link.id]);
  const read = await app.inject({ method: "GET", url: `/v1/payment-links/${link.token}` });
  assert.equal((read.json() as { status: string }).status, "expired");

  const pay = await app.inject({
    method: "POST",
    url: `/v1/payment-links/${link.token}/pay`,
    headers: { "idempotency-key": randomUUID() },
    payload: { card: CARD, submittedAt: new Date(Date.now() - 3_600_000).toISOString(), amountFils: 1 },
  });
  assert.equal(pay.statusCode, 410, pay.body);
  const txns = await pool.query(`SELECT 1 FROM transactions WHERE merchant_id = $1`, [merchantId]);
  assert.equal(txns.rows.length, 0, "no authorization, no capture");
});

test("FP-201: the bank sent the same callback twice and two identical notes were saved, now one payment keeps exactly one note", async () => {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `Case File fp201 ${randomUUID()}`,
  ]);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2) RETURNING id`,
    [m.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  const transactionId = t.rows[0]!.id;
  const raw = JSON.stringify({
    callbackId: `cb_${randomUUID()}`,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-09-16T10:00:00.000Z",
    outcome: "confirmed_fraud",
    note: "Manual review flagged card testing pattern.",
  });
  const send = () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", ACQUIRER_SECRET).update(`${ts}.${raw}`).digest("hex");
    return app.inject({
      method: "POST",
      url: "/v1/acquirer/callbacks",
      headers: { "content-type": "application/json", "acquirer-callback-signature": `t=${ts},v1=${sig}` },
      payload: raw,
    });
  };
  const [first, second] = await Promise.all([send(), send()]); // the same callback, delivered twice at once
  const third = await send(); // and once more, later
  for (const res of [first, second, third]) assert.ok(res.statusCode < 500, `${res.statusCode} ${res.body}`);
  assert.ok([first, second].some((r) => r.statusCode < 300), "the callback itself is accepted");
  const notes = await pool.query(`SELECT 1 FROM acquirer_callback_notes WHERE transaction_id = $1`, [transactionId]);
  assert.equal(notes.rows.length, 1);
});

test("FP-209: two refunds of the same payment at the same time both went through, now exactly one succeeds and money out never exceeds the capture", async () => {
  const { merchantId, headers } = await approvedMerchant("fp209");
  const transactionId = await capture(headers, 10_000);
  const results = await Promise.all([refund(headers, transactionId, 10_000), refund(headers, transactionId, 10_000)]);
  const codes = results.map((r) => r.statusCode).sort();
  assert.equal(codes.filter((c) => c === 200).length, 1, codes.join(","));
  assert.ok(codes.every((c) => c === 200 || (c >= 400 && c < 500)), codes.join(","));
  const r = await pool.query<{ n: string; refunded: string }>(
    `SELECT (SELECT count(*) FROM refunds WHERE transaction_id = $1)::text AS n,
            (SELECT refunded_fils FROM transactions WHERE id = $1)::text AS refunded`,
    [transactionId],
  );
  assert.equal(Number(r.rows[0]!.n), 1);
  assert.equal(Number(r.rows[0]!.refunded), 10_000);
  assert.equal(await net(merchantId, "card_scheme_clearing", transactionId), 0, "10,000 in, 10,000 out, not 20,000");
});

test("FP-240: merchants could not verify our webhook signatures, now the signature verifies as HMAC(secret, t + '.' + the exact body sent)", async () => {
  const { merchantId, headers } = await approvedMerchant("fp240");
  const url = `https://merchant-${randomUUID()}.example.com/hooks`;
  const created = await app.inject({ method: "POST", url: `/v1/merchants/${merchantId}/webhook-endpoints`, headers, payload: { url } });
  assert.equal(created.statusCode, 201, created.body);
  const { id, secret } = created.json() as { id: string; secret: string };
  const res = await app.inject({ method: "POST", url: `/v1/merchants/${merchantId}/webhook-endpoints/${id}/test`, headers });
  assert.equal(res.statusCode, 200, res.body);
  const req = sent.find((s) => s.url === url);
  assert.ok(req, "the test event was sent");
  const header = req.headers["Webhook-Signature"] ?? "";
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  assert.ok(m, header);
  const expected = createHmac("sha256", secret).update(`${m[1]}.${req.body}`).digest("hex");
  assert.equal(m[2], expected, "a receiver verifying over the raw body it received gets a match");
});

test("FP-240 (incoming): the incoming acquirer signature check re-serialised the body, now a callback signed over its exact raw bytes is accepted and a tampered one is not", async () => {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `Case File fp240in ${randomUUID()}`,
  ]);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2) RETURNING id`,
    [m.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  // The acquirer's own serialisation: spaces after separators, not V8's JSON.stringify output.
  const raw = `{ "callbackId": "cb_${randomUUID()}", "type": "fraud_review.completed", "transactionId": "${t.rows[0]!.id}", "occurredAt": "2026-09-16T10:00:00.000Z", "outcome": "confirmed_fraud", "note": "ok" }`;
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", ACQUIRER_SECRET).update(`${ts}.${raw}`).digest("hex");
  const ok = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": `t=${ts},v1=${sig}` },
    payload: raw,
  });
  assert.ok(ok.statusCode < 300, `${ok.statusCode} ${ok.body}`);
  const tampered = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": `t=${ts},v1=${sig}` },
    payload: raw.replace('"ok"', '"tampered"'),
  });
  assert.equal(tampered.statusCode, 401, tampered.body);
});

test("INCIDENT 2026-05-14: a slow payment let a second buyer use the same link before the first finished and both were charged, now only one buyer is charged", async () => {
  const { merchantId, headers } = await approvedMerchant("inc0514");
  const link = await createLink(headers, merchantId);
  const real = createAcquirerSimulator(config);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let reachedAcquirer!: () => void;
  const firstAtAcquirer = new Promise<void>((r) => (reachedAcquirer = r));
  const slow: AcquirerSimulator = {
    authorize: async (req) => {
      reachedAcquirer();
      await gate; // the first buyer's payment is slow at the acquirer
      return real.authorize(req);
    },
    capture: (req) => real.capture(req),
    refund: (req) => real.refund(req),
  };
  const cfg = { paymentLinkReservationTimeoutSeconds: config.paymentLinkReservationTimeoutSeconds };
  const first = payPaymentLink(pool, slow, cfg, { token: link.token, card: CARD, idempotencyKey: randomUUID() });
  await firstAtAcquirer;
  // The first buyer is still in flight, but its reservation is now older than the timeout.
  await pool.query(`UPDATE payment_links SET reserved_at = reserved_at - interval '10 minutes' WHERE id = $1`, [link.id]);
  const second = await app.inject({ method: "POST", url: `/v1/payment-links/${link.token}/pay`, headers: { "idempotency-key": randomUUID() }, payload: { card: CARD } });
  release();
  const firstResult = await first;

  const codes = [firstResult.statusCode, second.statusCode];
  assert.equal(codes.filter((c) => c === 200).length, 1, codes.join(","));
  const charged = await pool.query<{ n: string; s: string | null }>(
    `SELECT count(*)::text AS n, SUM(captured_fils)::text AS s FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`,
    [merchantId],
  );
  assert.equal(Number(charged.rows[0]!.n), 1, "one buyer charged");
  assert.equal(Number(charged.rows[0]!.s), 4_750);
  assert.equal(await net(merchantId, "card_scheme_clearing"), -4_750, "one charge in the ledger");
});

// ---------- Page 4: handwritten box ----------

test("H1: a refund could exceed what was actually charged, now a refund above the captured amount is refused and writes nothing", async () => {
  const { merchantId, headers } = await approvedMerchant("h1");
  const transactionId = await capture(headers, 10_000, 6_000); // authorised 10,000, charged 6,000
  const over = await refund(headers, transactionId, 6_001);
  assert.ok(over.statusCode >= 400 && over.statusCode < 500, `${over.statusCode} ${over.body}`);
  const partial = await refund(headers, transactionId, 4_000);
  assert.equal(partial.statusCode, 200, partial.body);
  const overRest = await refund(headers, transactionId, 2_001);
  assert.ok(overRest.statusCode >= 400 && overRest.statusCode < 500, `${overRest.statusCode} ${overRest.body}`);
  const rest = await refund(headers, transactionId, 2_000);
  assert.equal(rest.statusCode, 200, rest.body);
  const r = await pool.query<{ refunded: string; n: string }>(
    `SELECT refunded_fils::text AS refunded, (SELECT count(*) FROM refunds WHERE transaction_id = $1)::text AS n FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(r.rows[0]!.refunded), 6_000);
  assert.equal(Number(r.rows[0]!.n), 2);
  assert.equal(await net(merchantId, "card_scheme_clearing", transactionId), 0);
});

test("H3: some admin actions lacked role checks, now a support admin is refused every money-moving admin action", async () => {
  const support = await signedInAdmin("support");
  const { merchantId, keyId } = await approvedMerchant("h3");
  const before = await pool.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  const calls: Array<[string, string, object]> = [
    ["POST", "/v1/admin/balances/rebuild", {}],
    ["POST", "/v1/admin/settlement/run-batch", { date: "2025-01-01", merchantId }],
    ["POST", `/v1/admin/merchants/${merchantId}/mdr-recalculation`, { from: "2025-01-01", to: "2025-01-02" }],
    ["POST", `/v1/admin/merchants/${merchantId}/balance-adjustments`, { amountFils: 1_000, reason: "x" }],
    ["POST", `/v1/admin/merchants/${merchantId}/credits`, { amountFils: 1_000, reason: "x" }],
    ["POST", "/v1/admin/adjustment-imports", { csvContent: `merchantId,amount,reason\n${merchantId},1.000,x\n` }],
    ["POST", `/v1/admin/merchants/${merchantId}/api-keys/${keyId}/rotate`, {}],
  ];
  for (const [method, url, payload] of calls) {
    const res = await app.inject({ method: method as "POST", url, headers: { cookie: support.cookie }, payload });
    assert.equal(res.statusCode, 403, `${url}: ${res.body}`);
  }
  const after = await pool.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  assert.equal(after.rows.length, before.rows.length);
});

test("H4: the key rotation flow did not do what you'd expect, now rotating an API key revokes the old key and only the new one works", async () => {
  const { merchantId, keyId, headers } = await approvedMerchant("h4");
  const finance = await signedInAdmin("finance");
  const rot = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/api-keys/${keyId}/rotate`,
    headers: { cookie: finance.cookie },
    payload: {},
  });
  assert.equal(rot.statusCode, 201, rot.body);
  const newKey = (rot.json() as { rawKey: string }).rawKey;
  const oldRes = await app.inject({ method: "GET", url: "/v1/transactions", headers });
  assert.equal(oldRes.statusCode, 401, oldRes.body);
  const newRes = await app.inject({ method: "GET", url: "/v1/transactions", headers: { authorization: `Bearer ${newKey}` } });
  assert.equal(newRes.statusCode, 200, newRes.body);
});

test("H8: the OTP implementation changed, now a wrong code never authenticates and the right code does", async () => {
  const s = await signupAndLogin();
  const wrong = s.otp === "000000" ? "111111" : "000000";
  const bad = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: s.pendingCookie }, payload: { code: wrong } });
  assert.ok(bad.statusCode >= 400 && bad.statusCode < 500, `${bad.statusCode} ${bad.body}`);
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: s.pendingCookie } });
  assert.equal(me.statusCode, 401, me.body);
  const good = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: s.pendingCookie }, payload: { code: s.otp } });
  assert.equal(good.statusCode, 200, good.body);
});

// ---------- Page 2: FP-300 (refunds), done-when boxes ----------

test("FP-300: a refund through the API was never finished, now ledger, fee, webhook event and timeline are right to the fils", async () => {
  const { merchantId, headers } = await approvedMerchant("fp300", 250);
  const transactionId = await capture(headers, 10_000);
  const payableBefore = await net(merchantId, "merchant_payable", transactionId);
  assert.equal(payableBefore, 9_750, "10,000 captured less a 250 fils fee");

  const res = await refund(headers, transactionId, 4_000);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { amountFils: number; feeReversedFils: number; transactionStatus: string };
  assert.equal(body.amountFils, 4_000);
  assert.equal(body.feeReversedFils, 100, "250 bps of 4,000");
  assert.equal(body.transactionStatus, "partially_refunded");

  // Ledger: every entry group balances, and each account moved by exactly the refund.
  const groups = await pool.query<{ d: string; c: string }>(
    `SELECT SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE 0 END)::text AS d,
            SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE 0 END)::text AS c
       FROM ledger_entries WHERE transaction_id = $1 GROUP BY entry_group_id`,
    [transactionId],
  );
  for (const g of groups.rows) assert.equal(g.d, g.c);
  assert.equal(await net(merchantId, "merchant_payable", transactionId), 9_750 - (4_000 - 100));
  assert.equal(await net(merchantId, "platform_fee_revenue", transactionId), 250 - 100);
  assert.equal(await net(merchantId, "card_scheme_clearing", transactionId), -10_000 + 4_000);

  // Webhook: one refund.succeeded event for this payment.
  const outbox = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'refund.succeeded'`,
    [transactionId],
  );
  assert.equal(outbox.rows.length, 1);
  assert.ok(JSON.stringify(outbox.rows[0]!.payload).includes("4000"), JSON.stringify(outbox.rows[0]!.payload));

  // Timeline: the merchant sees the refund on the payment.
  const events = await app.inject({ method: "GET", url: `/v1/transactions/${transactionId}/events`, headers });
  assert.equal(events.statusCode, 200, events.body);
  assert.match(events.body, /refund_partial/);
});

test("FP-300 (reports and reconciliation): a refunded two-part capture shows up right in the summary, the report and reconciliation, which ties out to 0", async () => {
  const { headers } = await approvedMerchant("fp300-recon", 250);
  const auth = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: CARD, reference: "case-file" },
  });
  assert.equal(auth.statusCode, 201, auth.body);
  const transactionId = (auth.json() as { id: string }).id;
  for (const payload of [{ amountFils: 6_000 }, { amountFils: 4_000 }]) {
    const cap = await app.inject({
      method: "POST",
      url: `/v1/transactions/${transactionId}/capture`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload,
    });
    assert.equal(cap.statusCode, 200, cap.body);
  }
  const ref = await refund(headers, transactionId, 4_000);
  assert.equal(ref.statusCode, 200, ref.body);

  // A three-day Bahrain window around today, so the test never depends on which side of midnight it runs.
  const day = (offset: number) => new Date(Date.now() + 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
  const query = `from=${day(-1)}&to=${day(2)}`;

  const summary = await app.inject({ method: "GET", url: `/v1/settlement/summary?${query}`, headers });
  assert.equal(summary.statusCode, 200, summary.body);
  const s = summary.json() as { transactionCount: number; totalCapturedFils: number };
  assert.deepEqual([s.transactionCount, s.totalCapturedFils], [1, 10_000], "captured once in total, not per capture event");

  const report = await app.inject({ method: "GET", url: "/v1/reporting/transactions", headers });
  assert.equal(report.statusCode, 200, report.body);
  const rows = report.json() as Array<{ id: string; status: string; capturedBhd: string }>;
  assert.deepEqual(
    rows.map((r) => [r.id, r.status, r.capturedBhd]),
    [[transactionId, "partially_refunded", "10.000"]],
  );

  const recon = await app.inject({ method: "GET", url: `/v1/settlement/reconciliation?${query}`, headers });
  assert.equal(recon.statusCode, 200, recon.body);
  const r = recon.json() as { ledgerMerchantPayableNetFils: number; gapFils: number; explained: boolean };
  assert.equal(r.ledgerMerchantPayableNetFils, 10_000 - 250 - (4_000 - 100));
  assert.equal(r.gapFils, 0, recon.body);
  assert.equal(r.explained, true, recon.body);
});

test("G3/H7 (admin tools): running the finance status backfill on a test merchant took it live into the real settlement run, now it stays a test merchant", async () => {
  const finance = await signedInAdmin("finance");
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, test_mode) VALUES ($1, 250, true) RETURNING id`,
    [`Case File g3 sandbox ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  await pool.query(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2)`,
    [merchantId, `acqref_${randomUUID()}`],
  );
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/transactions/recompute-statuses`,
    headers: { cookie: finance.cookie },
    payload: {},
  });
  assert.equal(res.statusCode, 200, res.body);
  const flag = await pool.query<{ test_mode: boolean }>(`SELECT test_mode FROM merchants WHERE id = $1`, [merchantId]);
  assert.equal(flag.rows[0]!.test_mode, true);
});

test("H1 (chargebacks): a status backfill could turn a charged-back payment back into a refundable capture, now it stays a chargeback and cannot be refunded", async () => {
  const { merchantId, headers } = await approvedMerchant("h1-chargeback");
  const finance = await signedInAdmin("finance");
  const t = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'chargeback', 5000, 5000, $2) RETURNING id`,
    [merchantId, `acqref_${randomUUID()}`],
  );
  const transactionId = t.rows[0]!.id;
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/transactions/recompute-statuses`,
    headers: { cookie: finance.cookie },
    payload: {},
  });
  assert.equal(res.statusCode, 200, res.body);
  const status = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [transactionId]);
  assert.equal(status.rows[0]!.status, "chargeback");
  const r = await refund(headers, transactionId, 5_000);
  assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${r.statusCode} ${r.body}`);
  const refunds = await pool.query(`SELECT 1 FROM refunds WHERE transaction_id = $1`, [transactionId]);
  assert.equal(refunds.rows.length, 0);
});

test("H9: a really large export was built whole in memory, now an export past 50,000 rows is refused up front and a narrower range still exports", async () => {
  const { merchantId, headers } = await approvedMerchant("h9");
  // 50,001 voided rows (no money moves, nothing to settle) on 14 Jul 2019 (Bahrain), all for this merchant.
  await pool.query(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
     SELECT $1, 'voided', 1000, 0, 'h9-' || g, timestamptz '2019-07-13T21:00:00Z' + g * interval '1 second'
       FROM generate_series(1, 50001) AS g`,
    [merchantId],
  );
  const all = await app.inject({ method: "GET", url: "/v1/transactions/export", headers });
  assert.equal(all.statusCode, 400, all.body.slice(0, 200));
  assert.equal((all.json() as { error: string }).error, "export_too_large");

  const narrow = await app.inject({
    method: "GET",
    url: "/v1/transactions/export?from=2019-07-13T21:00:00Z&to=2019-07-13T21:16:41Z",
    headers,
  });
  assert.equal(narrow.statusCode, 200, narrow.body.slice(0, 200));
  assert.equal(narrow.body.trim().split("\n").length, 1 + 1_000, "header + 1,000 rows");
});

test("FP-209 (partial refunds): three concurrent partial refunds could together pay out more than was charged, now only those that fit go through", async () => {
  const { merchantId, headers } = await approvedMerchant("fp209-partial");
  const transactionId = await capture(headers, 10_000);
  const results = await Promise.all([1, 2, 3].map(() => refund(headers, transactionId, 4_000)));
  const codes = results.map((r) => r.statusCode);
  assert.equal(codes.filter((c) => c === 200).length, 2, codes.join(","));
  assert.ok(codes.every((c) => c === 200 || (c >= 400 && c < 500)), codes.join(","));
  const r = await pool.query<{ refunded: string }>(`SELECT refunded_fils::text AS refunded FROM transactions WHERE id = $1`, [transactionId]);
  assert.equal(Number(r.rows[0]!.refunded), 8_000);
  assert.equal(await net(merchantId, "card_scheme_clearing", transactionId), -10_000 + 8_000);
});

test("H1 (nothing charged): a payment that was only authorised or was voided has nothing to refund, now any refund of it is refused", async () => {
  const { headers } = await approvedMerchant("h1-uncaptured");
  const authorise = async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { amountFils: 10_000, card: CARD, reference: "case-file" },
    });
    assert.equal(res.statusCode, 201, res.body);
    return (res.json() as { id: string }).id;
  };
  const authorisedOnly = await authorise();
  const voided = await authorise();
  const v = await app.inject({ method: "POST", url: `/v1/transactions/${voided}/void`, headers: { ...headers, "idempotency-key": randomUUID() }, payload: {} });
  assert.equal(v.statusCode, 200, v.body);
  for (const transactionId of [authorisedOnly, voided]) {
    const res = await refund(headers, transactionId, 1);
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${res.statusCode} ${res.body}`);
    const rows = await pool.query(`SELECT 1 FROM refunds WHERE transaction_id = $1`, [transactionId]);
    assert.equal(rows.rows.length, 0);
  }
});

test("G4 (admin console): an admin password without the OTP code opened the console, now a pending admin session is refused", async () => {
  adminHash ??= await hashPassword(ADMIN_PASSWORD, config);
  const email = `case-file-${randomUUID()}@admin.test`;
  await pool.query(`INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Case file', 'super_admin')`, [email, adminHash]);
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password: ADMIN_PASSWORD } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = cookieOf(login.headers["set-cookie"], config.adminCookieName);
  for (const url of ["/v1/admin/auth/me", "/v1/admin/merchants"]) {
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(res.statusCode, 401, `${url}: ${res.body}`);
  }
});

test("H8 (brute force): guessing the OTP was unbounded, now after the attempt budget even the right code is refused", async () => {
  const s = await signupAndLogin();
  const wrong = s.otp === "000000" ? "111111" : "000000";
  for (let i = 0; i < config.otpMaxAttempts; i++) {
    const bad = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: s.pendingCookie }, payload: { code: wrong } });
    assert.ok(bad.statusCode >= 400 && bad.statusCode < 500, `${bad.statusCode} ${bad.body}`);
  }
  const late = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: s.pendingCookie }, payload: { code: s.otp } });
  assert.ok(late.statusCode >= 400 && late.statusCode < 500, `${late.statusCode} ${late.body}`);
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: s.pendingCookie } });
  assert.equal(me.statusCode, 401, me.body);
});

test("FP-300 (webhook): the shop never got a refund webhook it could verify, now its endpoint gets exactly one signed refund.succeeded for the refund", async () => {
  const { merchantId, headers } = await approvedMerchant("fp300-webhook", 250);
  const url = `https://merchant-${randomUUID()}.example.com/hooks`;
  const created = await app.inject({ method: "POST", url: `/v1/merchants/${merchantId}/webhook-endpoints`, headers, payload: { url } });
  assert.equal(created.statusCode, 201, created.body);
  const { secret } = created.json() as { secret: string };
  const transactionId = await capture(headers, 10_000);
  const res = await refund(headers, transactionId, 4_000);
  assert.equal(res.statusCode, 200, res.body);

  const received: WebhookTransportRequest[] = [];
  const shop = async (req: WebhookTransportRequest) => {
    if (req.url === url) received.push(req);
    return { statusCode: 200, body: "ok" };
  };
  const refundEvents = () => received.filter((r) => r.body.includes('"refund.succeeded"'));
  for (let pass = 0; pass < 20 && refundEvents().length === 0; pass++) await runDispatchPass(pool, shop, config);
  await runDispatchPass(pool, shop, config); // one more pass must not re-send it

  const events = refundEvents();
  assert.equal(events.length, 1, received.map((r) => r.body).join("\n"));
  const req = events[0]!;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(req.headers["Webhook-Signature"] ?? "");
  assert.ok(m, req.headers["Webhook-Signature"]);
  assert.equal(m[2], createHmac("sha256", secret).update(`${m[1]}.${req.body}`).digest("hex"));
  assert.ok(req.body.includes(transactionId), req.body);
  assert.match(req.body, /"amountFils":4000\b/, req.body);
});

test("H3 (impersonation): an admin's view-as-merchant session could move the merchant's money, now it can read but every write is refused", async () => {
  const { merchantId, headers } = await approvedMerchant("h3-impersonation");
  const captured = await capture(headers, 10_000);
  const authorised = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { amountFils: 5_000, card: CARD, reference: "case-file" },
  });
  assert.equal(authorised.statusCode, 201, authorised.body);
  const link = await createLink(headers, merchantId);
  const admin = await signedInAdmin("super_admin");
  const start = await app.inject({ method: "POST", url: `/v1/admin/merchants/${merchantId}/impersonate`, headers: { cookie: admin.cookie }, payload: {} });
  assert.equal(start.statusCode, 201, start.body);
  const cookie = cookieOf(start.headers["set-cookie"], config.impersonationCookieName);

  const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie } });
  assert.equal(read.statusCode, 200, read.body);
  const writes: Array<["POST" | "DELETE", string, object | undefined]> = [
    ["POST", "/v1/refunds", { transactionId: captured, amountFils: 1_000, reason: "customer_request" }],
    ["POST", `/v1/transactions/${(authorised.json() as { id: string }).id}/capture`, {}],
    ["POST", `/v1/transactions/${(authorised.json() as { id: string }).id}/void`, {}],
    ["DELETE", `/v1/merchants/${merchantId}/payment-links/${link.id}`, undefined],
    ["POST", `/v1/merchants/${merchantId}/webhook-endpoints`, { url: "https://attacker.example.com/hook" }],
    ["POST", `/v1/merchants/${merchantId}/api-keys`, { label: "impersonator" }],
  ];
  for (const [method, url, payload] of writes) {
    const res = await app.inject({ method, url, headers: { cookie, "idempotency-key": randomUUID() }, ...(payload ? { payload } : {}) });
    assert.ok([401, 403].includes(res.statusCode), `${method} ${url}: ${res.statusCode} ${res.body}`);
  }
  const refunds = await pool.query(`SELECT 1 FROM refunds WHERE transaction_id = $1`, [captured]);
  assert.equal(refunds.rows.length, 0);
  const l = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE id = $1`, [link.id]);
  assert.equal(l.rows[0]!.status, "active");
});

test("INCIDENT 2026-05-14 (simultaneous buyers): several buyers paying the same link at once were all charged, now exactly one is", async () => {
  const { merchantId, headers } = await approvedMerchant("inc0514-burst");
  const link = await createLink(headers, merchantId);
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      app.inject({ method: "POST", url: `/v1/payment-links/${link.token}/pay`, headers: { "idempotency-key": randomUUID() }, payload: { card: CARD } }),
    ),
  );
  const codes = results.map((r) => r.statusCode);
  assert.equal(codes.filter((c) => c === 200).length, 1, codes.join(","));
  const charged = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM transactions WHERE merchant_id = $1 AND captured_fils > 0`, [merchantId]);
  assert.equal(Number(charged.rows[0]!.n), 1);
  assert.equal(await net(merchantId, "card_scheme_clearing"), -4_750);
});

test("G1/H5 (merchant reports): the business day ran on UTC (a 3 am local cut-off), now a day in the summary and the report is midnight to midnight Asia/Bahrain", async () => {
  const { merchantId, headers } = await approvedMerchant("g1-day");
  // Fixed instants around 10/11 Mar 2019, Bahrain (UTC+3): 23:59:59 on the 10th, 00:00:00 and 02:59:59 on the 11th.
  const captures: Array<[number, string]> = [
    [1_000, "2019-03-10T20:59:59Z"],
    [2_000, "2019-03-10T21:00:00Z"],
    [4_000, "2019-03-10T23:59:59Z"],
  ];
  for (const [fils, at] of captures) {
    const t = await pool.query<{ id: string }>(
      `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
       VALUES ($1, 'captured', $2, $2, $3, $4) RETURNING id`,
      [merchantId, fils, `acqref_${randomUUID()}`, at],
    );
    await pool.query(
      `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at) VALUES ($1, 'captured', $2, 'system', $3)`,
      [t.rows[0]!.id, fils, at],
    );
  }
  const summary = async (from: string, to: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/settlement/summary?from=${from}&to=${to}`, headers });
    assert.equal(res.statusCode, 200, res.body);
    const s = res.json() as { transactionCount: number; totalCapturedFils: number };
    return [s.transactionCount, s.totalCapturedFils];
  };
  assert.deepEqual(await summary("2019-03-10", "2019-03-11"), [1, 1_000]);
  assert.deepEqual(await summary("2019-03-11", "2019-03-12"), [2, 6_000]);

  const filter = encodeURIComponent(JSON.stringify({ from: "2019-03-11", to: "2019-03-12" }));
  const report = await app.inject({ method: "GET", url: `/v1/reporting/transactions?filter=${filter}`, headers });
  assert.equal(report.statusCode, 200, report.body);
  assert.deepEqual((report.json() as Array<{ capturedBhd: string }>).map((r) => r.capturedBhd).sort(), ["2.000", "4.000"]);
});
