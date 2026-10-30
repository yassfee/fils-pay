import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("securityHeaders.audit.test.ts requires DATABASE_URL");

const kycDir = mkdtempSync(join(tmpdir(), "kyc-sec4-"));
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: kycDir,
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

async function ownerSession() {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`Sec4 ${randomUUID()}`]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [m.rows[0]!.id, `owner-${randomUUID()}@example.test`],
  );
  const raw = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at) VALUES ($1, $2, true, now() + interval '10 minutes')`,
    [u.rows[0]!.id, sha256Hex(raw)],
  );
  return { merchantId: m.rows[0]!.id, userId: u.rows[0]!.id, cookie: `${config.cookieName}=${raw}` };
}

// SEC4: authenticated JSON must not be sniffed, cached or framed (OWASP secure headers).
test("SEC4: responses carry nosniff, no-store and frame-ancestors headers", async () => {
  const owner = await ownerSession();
  const res = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: owner.cookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["content-security-policy"], "frame-ancestors 'none'");
});
