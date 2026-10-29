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
