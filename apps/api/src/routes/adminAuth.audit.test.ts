/**
 * Audit regression tests for the admin login / OTP routes (case ref H8).
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
import { hashPassword } from "../adminAuth/passwords.js";

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

// AUTH-5 (H8): the admin attempt cap must hold under concurrency too.
test("AUTH-5: parallel wrong admin OTP guesses cannot exceed max_attempts", async () => {
  const email = `burst-${randomUUID()}@admin.test`;
  const password = "admin burst password 123!";
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Audit burst', 'finance')`,
    [email, await hashPassword(password, config)],
  );
  const loginRes = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  const header = loginRes.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)!.split(";")[0] as string;
  const code = (loginRes.json() as { devOtpCode: string }).devOtpCode;
  const wrong = (i: number) => String((Number(code) + 1 + i) % 10 ** code.length).padStart(code.length, "0");
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie }, payload: { code: wrong(i) } }),
    ),
  );
  const checked = results.filter((r) => r.statusCode === 401 && r.json().error === "invalid_code").length;
  assert.ok(checked <= config.otpMaxAttempts, `${checked} guesses were checked; cap is ${config.otpMaxAttempts}`);
});

// AUTH-13 (H8): same per-account cap on the admin plane.
test("AUTH-13: an admin gets at most 10 OTP challenges per 15 minutes, even in parallel", async () => {
  const email = `relogin-${randomUUID()}@admin.test`;
  const password = "admin relogin password 123!";
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Audit relogin', 'finance') RETURNING id`,
    [email, await hashPassword(password, config)],
  );
  const results = await Promise.all(
    Array.from({ length: 15 }, () => app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } })),
  );
  const challenges = await pool.query(`SELECT 1 FROM admin_otp_challenges WHERE admin_user_id = $1`, [admin.rows[0]!.id]);
  assert.deepEqual(
    { ok: results.filter((r) => r.statusCode === 200).length, limited: results.filter((r) => r.statusCode === 429).length, challenges: challenges.rowCount },
    { ok: 10, limited: 5, challenges: 10 },
  );
});
