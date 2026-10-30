/**
 * Audit regression tests for the merchant login / OTP routes (case ref H8).
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: mkdtempSync(join(tmpdir(), "filspay-audit-")),
  OTP_DEV_EXPOSE: "true",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

async function signup(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/merchants",
    payload: {
      businessProfile: {
        legalName: `Audit Co ${randomUUID().slice(0, 8)}`,
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
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { merchantId: string }).merchantId;
}

async function login(merchantId: string, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password } });
  assert.equal(res.statusCode, 200, res.body);
  const header = res.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)!.split(";")[0] as string;
  return { cookie, code: (res.json() as { devOtpCode: string }).devOtpCode };
}

// AUTH-2 (H8): an attacker who registers the victim's email under a new tenant
// with their own password must get a session for their own tenant only.
test("AUTH-2: login binds the OTP and session to the user whose password was checked", async () => {
  const email = `shared-${randomUUID()}@example.test`;
  const victimMerchantId = await signup(email, "victim password 123!");
  const attackerMerchantId = await signup(email, "attacker password 456!");

  const { cookie, code } = await login(attackerMerchantId, email, "attacker password 456!");
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });
  assert.equal(verify.statusCode, 200, verify.body);
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  const merchant = (me.json() as { merchant: { id: string } }).merchant.id;
  assert.notEqual(merchant, victimMerchantId, "session must not land in the victim's tenant");
  assert.equal(merchant, attackerMerchantId);
});

// AUTH-5 (H8): the attempt cap must hold under concurrency. A burst of wrong
// guesses on one pending cookie must never be checked more than max_attempts times.
test("AUTH-5: parallel wrong OTP guesses cannot exceed max_attempts", async () => {
  const email = `burst-${randomUUID()}@example.test`;
  const merchantId = await signup(email, "burst password 123!");
  const { cookie, code } = await login(merchantId, email, "burst password 123!");
  const wrong = (i: number) => String((Number(code) + 1 + i) % 10 ** code.length).padStart(code.length, "0");
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code: wrong(i) } }),
    ),
  );
  const checked = results.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
  assert.ok(checked <= config.otpMaxAttempts, `${checked} guesses were checked; cap is ${config.otpMaxAttempts}`);
});

// AUTH-9: the login cookie carries the 10-minute pending Max-Age; verify must
// re-issue it for the promoted session's full TTL or the browser drops it after 10 minutes.
test("AUTH-9: OTP verify re-issues fp_sid with the full session Max-Age", async () => {
  const email = `ttl-${randomUUID()}@example.test`;
  const merchantId = await signup(email, "ttl password 123!");
  const { cookie, code } = await login(merchantId, email, "ttl password 123!");
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });
  assert.equal(verify.statusCode, 200, verify.body);
  const header = verify.headers["set-cookie"];
  const setCookie = (Array.isArray(header) ? header[0] : header) ?? "";
  assert.ok(setCookie.startsWith(`${cookie};`), `verify must re-set ${config.cookieName}, got: ${setCookie || "no Set-Cookie"}`);
  assert.match(setCookie, new RegExp(`Max-Age=${config.sessionTtlHours * 3600}(;|$)`));
});

// AUTH-13 (H8): every login mints a fresh 5-guess OTP challenge, so re-logging-in made the OTP cap
// meaningless. Challenges are now capped per user (10 per 15 minutes), also under concurrency.
test("AUTH-13: a merchant user gets at most 10 OTP challenges per 15 minutes, even in parallel", async () => {
  const email = `relogin-${randomUUID()}@example.test`;
  const merchantId = await signup(email, "relogin password 123!");
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: "relogin password 123!" } }),
    ),
  );
  const challenges = await pool.query(
    `SELECT 1 FROM otp_challenges c JOIN merchant_users mu ON mu.id = c.merchant_user_id WHERE mu.merchant_id = $1`,
    [merchantId],
  );
  assert.deepEqual(
    { ok: results.filter((r) => r.statusCode === 200).length, limited: results.filter((r) => r.statusCode === 429).length, challenges: challenges.rowCount },
    { ok: 10, limited: 5, challenges: 10 },
  );
});

// ERR-1: a NUL byte in a JSON string reaches Postgres, which rejects it (22021); that is the
// client's bad input, so it must be a 400, not a 500 internal_error.
test("ERR-1: a NUL byte in a request string is a 400, not a 500", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { merchantId: randomUUID(), email: "nul\u0000@example.test", password: "irrelevant password" },
  });
  assert.deepEqual({ status: res.statusCode, error: res.json().error }, { status: 400, error: "invalid_request" });
});

// AUTH-13: only never-verified challenges count, so a user (or load test) that verifies every login is never capped.
test("AUTH-13: 11 merchant logins that each verify their OTP all succeed", async () => {
  const email = `verified-${randomUUID()}@example.test`;
  const merchantId = await signup(email, "verified password 123!");
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId, email, password: "verified password 123!" } });
    statuses.push(res.statusCode);
    if (res.statusCode !== 200) continue;
    const header = res.headers["set-cookie"];
    const cookie = (Array.isArray(header) ? header[0] : header)!.split(";")[0] as string;
    const code = (res.json() as { devOtpCode: string }).devOtpCode;
    const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie }, payload: { code } });
    statuses.push(verify.statusCode);
  }
  assert.deepEqual(statuses, Array(22).fill(200));
});
