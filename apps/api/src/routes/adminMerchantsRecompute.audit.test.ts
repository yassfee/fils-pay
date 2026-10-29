/**
 * Audit tests for the finance "Recompute transaction statuses" backfill
 * (case file G3, H7). Real migrated Postgres, like the other route tests.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("adminMerchantsRecompute.audit.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function signedInFinanceCookie(): Promise<string> {
  const password = "admin-test-password-9000!";
  const email = `recompute-audit-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'Audit finance', 'finance')`,
    [email, await hashPassword(password, config)],
  );
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  const setCookie = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
  const cookie = setCookie.find((c) => c.startsWith(`${config.adminCookieName}=`))!.split(";")[0]!;
  const otp = (login.json() as { devOtpCode: string }).devOtpCode;
  const verify = await app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie }, payload: { code: otp } });
  assert.equal(verify.statusCode, 200, verify.body);
  return cookie;
}

// G3/H7: "Test merchants keep showing up in the real settlement run". Settlement's only sandbox
// guard is test_mode = false (batch.go), so a status backfill must never flip it.
test("recompute-statuses leaves a sandbox merchant in test_mode", async () => {
  const cookie = await signedInFinanceCookie();
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode) VALUES ($1, 320, 'active', true) RETURNING id`,
    [`Sandbox ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await pool.query(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 10000, 10000, $2)`,
    [merchantId, `acqref_${randomUUID()}`],
  );

  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/transactions/recompute-statuses`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual((res.json() as { flagsUpdated: string[] }).flagsUpdated, []);
  const after = await pool.query<{ test_mode: boolean }>(`SELECT test_mode FROM merchants WHERE id = $1`, [merchantId]);
  assert.equal(after.rows[0]!.test_mode, true);
});

// H7 / FP-300: nextStatusAfterRefund can never return 'chargeback', so the backfill rewrote a
// chargeback as 'captured' (a refundable status): a later refund would pay the money out twice.
test("recompute-statuses leaves chargeback transactions as chargeback", async () => {
  const cookie = await signedInFinanceCookie();
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode) VALUES ($1, 250, 'active', false) RETURNING id`,
    [`Chargeback ${randomUUID()}`],
  );
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'chargeback', 10000, 10000, $2) RETURNING id`,
    [merchant.rows[0]!.id, `acqref_${randomUUID()}`],
  );

  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchant.rows[0]!.id}/transactions/recompute-statuses`,
    headers: { cookie },
  });
  assert.equal(res.statusCode, 200, res.body);
  const after = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [txn.rows[0]!.id]);
  assert.equal(after.rows[0]!.status, "chargeback");
});
