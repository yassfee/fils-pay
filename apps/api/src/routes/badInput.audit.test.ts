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

test("API-4: a balance adjustment beyond the safe-integer range is a 400, not a 500", async () => {
  const cookie = await adminCookie("finance");
  const { merchantId } = await merchantOwnerCookie();
  for (const deltaFils of [1e20, -1e20, 2 ** 53]) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/admin/merchants/${merchantId}/balance-adjustments`,
      headers: { cookie, "idempotency-key": randomUUID() },
      payload: { deltaFils, reason: "api-4" },
    });
    assert.equal(res.statusCode, 400, `${deltaFils}: ${res.body}`);
  }
  const ledger = await pool.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  assert.equal(ledger.rowCount, 0, "nothing may be journaled");
});

test("HUNT-6: business-profile PATCH answers 400 for unknown keys and invalid values, and still applies valid ones", async () => {
  const { merchantId, cookie } = await merchantOwnerCookie();
  await pool.query(
    `INSERT INTO merchant_business_profiles (merchant_id, legal_name, registration_number, business_type, contact_email, contact_phone, address_line1, city)
     VALUES ($1, 'Legal', 'CR-1', 'llc', 'a@example.test', '+97300000000', 'Road 1', 'Manama')`,
    [merchantId],
  );
  const patch = (payload: unknown) =>
    app.inject({ method: "PATCH", url: `/v1/merchants/${merchantId}/business-profile`, headers: { cookie }, payload: payload as object });
  for (const bad of [{ foo: "x" }, { constructor: "x" }, { businessType: "bogus" }, { country: "BHR" }, { legalName: null }, { city: { a: 1 } }]) {
    const res = await patch(bad);
    assert.equal(res.statusCode, 400, `${JSON.stringify(bad)}: ${res.body}`);
  }
  const ok = await patch({ city: "Riffa", addressLine2: null, businessType: "partnership" });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((ok.json() as { city: string }).city, "Riffa");
});

async function approvedOwner(): Promise<{ merchantId: string; cookie: string }> {
  const owner = await merchantOwnerCookie();
  await pool.query(`UPDATE merchants SET onboarding_status = 'approved', kyc_passed = true WHERE id = $1`, [owner.merchantId]);
  return owner;
}

test("API-7: a zero-fils payment link is a 400, not a 500", async () => {
  const { merchantId, cookie } = await approvedOwner();
  const res = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { cookie },
    payload: { amountFils: 0, expiresAt: "2030-01-01T00:00:00Z" },
  });
  assert.equal(res.statusCode, 400, res.body);
  const links = await pool.query(`SELECT 1 FROM payment_links WHERE merchant_id = $1`, [merchantId]);
  assert.equal(links.rowCount, 0);
});

test("API-8: a webhook endpoint PATCH with an unknown status is a 400, not a 500", async () => {
  const { merchantId, cookie } = await approvedOwner();
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/webhook-endpoints`,
    headers: { cookie },
    payload: { url: "https://example.com/hooks" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = (created.json() as { id: string }).id;
  for (const status of ["bogus", 5, "ACTIVE"]) {
    const res = await app.inject({ method: "PATCH", url: `/v1/merchants/${merchantId}/webhook-endpoints/${id}`, headers: { cookie }, payload: { status } });
    assert.equal(res.statusCode, 400, `${JSON.stringify(status)}: ${res.body}`);
  }
  const ok = await app.inject({ method: "PATCH", url: `/v1/merchants/${merchantId}/webhook-endpoints/${id}`, headers: { cookie }, payload: { status: "disabled" } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((ok.json() as { status: string }).status, "disabled");
});

test("API-9: a KYC image with a valid signature but corrupt data is a 422, not a 500", async () => {
  const { merchantId, cookie } = await merchantOwnerCookie();
  const boundary = `----api9${randomUUID().replace(/-/g, "")}`;
  const body = (filename: string, contentType: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nowner_id\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  const corrupt: Array<[string, string, Buffer]> = [
    ["id.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
    ["id.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])],
  ];
  for (const [filename, contentType, data] of corrupt) {
    const res = await app.inject({
      method: "POST",
      url: `/v1/merchants/${merchantId}/kyc/documents`,
      headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body(filename, contentType, data),
    });
    assert.equal(res.statusCode, 422, `${filename}: ${res.body}`);
    assert.equal((res.json() as { error: string }).error, "invalid_file_type");
  }
  const docs = await pool.query(`SELECT 1 FROM kyc_documents WHERE merchant_id = $1`, [merchantId]);
  assert.equal(docs.rowCount, 0, "nothing is recorded for an undecodable image");
});

test("API-11: a non-numeric ?limit on the merchant list routes falls back to the default page, not a 404", async () => {
  const { merchantId, cookie } = await approvedOwner();
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/webhook-endpoints`,
    headers: { cookie },
    payload: { url: "https://example.com/hooks" },
  });
  const endpointId = (created.json() as { id: string }).id;
  for (const url of [
    "/v1/transactions?limit=abc",
    "/v1/settlement/batches?limit=abc",
    `/v1/merchants/${merchantId}/payment-links?limit=abc`,
    `/v1/merchants/${merchantId}/webhook-endpoints/${endpointId}/deliveries?limit=abc`,
  ]) {
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    assert.equal(res.statusCode, 200, `${url}: ${res.body}`);
  }
});
