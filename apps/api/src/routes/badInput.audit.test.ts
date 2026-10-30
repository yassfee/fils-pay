/**
 * Plainly invalid client input must be a 4xx, never a 500 (lane H; same class as ERR-1, SEC-1, IMP-4, HUNT-1).
 * Uses the real buildApp() and a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("badInput.audit.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

test("API-1: a malformed, empty, oversized or non-JSON request body is a 4xx, not a 500", async () => {
  const cases: Array<[string, string, number]> = [
    ["application/json", "{bad", 400], // FST_ERR_CTP_INVALID_JSON_BODY
    ["application/json", "", 400], // FST_ERR_CTP_EMPTY_JSON_BODY
    ["application/xml", "<a/>", 415], // FST_ERR_CTP_INVALID_MEDIA_TYPE
    ["application/json", `"${"x".repeat(1_100_000)}"`, 413], // FST_ERR_CTP_BODY_TOO_LARGE (1 MiB default)
  ];
  for (const url of ["/v1/auth/login", "/v1/merchants"]) {
    for (const [contentType, payload, expected] of cases) {
      const res = await app.inject({ method: "POST", url, headers: { "content-type": contentType }, payload });
      assert.equal(res.statusCode, expected, `${url} ${contentType} ${payload.slice(0, 8)}: ${res.body}`);
    }
  }
});

async function adminCookie(role: string): Promise<string> {
  const password = "admin-test-password-9000!";
  const email = `bad-input-${randomUUID()}@admin.test`;
  await pool.query(`INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Bad input', $3)`, [
    email,
    await hashPassword(password, config),
    role,
  ]);
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  const cookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${config.adminCookieName}=`))!.split(";")[0]!;
  const otp = (login.json() as { devOtpCode: string }).devOtpCode;
  const verify = await app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie }, payload: { code: otp } });
  assert.equal(verify.statusCode, 200, verify.body);
  return cookie;
}

test("API-2: admin merchant search with a repeated q is a 400, not a 500", async () => {
  const cookie = await adminCookie("support");
  const res = await app.inject({ method: "GET", url: "/v1/admin/merchants?q=a&q=b", headers: { cookie } });
  assert.equal(res.statusCode, 400, res.body);
  const ok = await app.inject({ method: "GET", url: "/v1/admin/merchants?q=a", headers: { cookie } });
  assert.equal(ok.statusCode, 200, ok.body);
});

async function merchantOwnerCookie(): Promise<{ merchantId: string; cookie: string }> {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [`bad-input ${randomUUID()}`]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [m.rows[0]!.id, `owner-${randomUUID()}@example.test`],
  );
  const raw = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at) VALUES ($1, $2, true, now() + interval '10 minutes')`,
    [u.rows[0]!.id, sha256Hex(raw)],
  );
  return { merchantId: m.rows[0]!.id, cookie: `${config.cookieName}=${raw}` };
}

test("API-3: a JSON null report filter is treated as no filter, not a 500", async () => {
  const { cookie } = await merchantOwnerCookie();
  const res = await app.inject({ method: "GET", url: "/v1/reporting/transactions?filter=null", headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  const none = await app.inject({ method: "GET", url: "/v1/reporting/transactions", headers: { cookie } });
  assert.deepEqual(res.json(), none.json(), "filter=null must answer exactly what no filter answers");
});
