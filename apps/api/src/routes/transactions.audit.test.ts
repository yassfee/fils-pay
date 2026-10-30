/**
 * AUTHZ-1 (H3): capture and void move money, so they take the same merchant role gate as every
 * other merchant money write (refunds, payment links, payouts: owner/finance). A 'support'
 * session (migration 0035: "the least-privileged" merchant role) must get 403 and change nothing.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("transactions.audit.test.ts requires DATABASE_URL");

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

async function sessionCookie(merchantId: string, role: string) {
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, $3, 'unused') RETURNING id`,
    [merchantId, `${role}-${randomUUID()}@example.test`, role],
  );
  const raw = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at)
     VALUES ($1, $2, true, now() + interval '10 minutes')`,
    [u.rows[0]!.id, sha256Hex(raw)],
  );
  return { userId: u.rows[0]!.id, cookie: `${config.cookieName}=${raw}` };
}

async function authorizedTxn(rawKey: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 10_000, card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" }, reference: "authz-1" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (res.json() as { id: string }).id;
}

const post = (url: string, cookie: string) =>
  app.inject({ method: "POST", url, headers: { cookie, "idempotency-key": randomUUID() }, payload: {} });

test("AUTHZ-1: a support-role session cannot capture or void; an owner session still can", async () => {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `AUTHZ-1 ${randomUUID()}`,
  ]);
  const merchantId = m.rows[0]!.id;
  const owner = await sessionCookie(merchantId, "owner");
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: owner.userId, label: "authz-1" });
  const support = await sessionCookie(merchantId, "support");

  const t1 = await authorizedTxn(rawKey);
  const t2 = await authorizedTxn(rawKey);
  const cap = await post(`/v1/transactions/${t1}/capture`, support.cookie);
  assert.equal(cap.statusCode, 403, cap.body);
  const vd = await post(`/v1/transactions/${t2}/void`, support.cookie);
  assert.equal(vd.statusCode, 403, vd.body);
  const st = await pool.query<{ id: string; status: string }>(`SELECT id, status FROM transactions WHERE id = ANY($1)`, [[t1, t2]]);
  for (const row of st.rows) assert.equal(row.status, "authorized", `${row.id} changed by a support session`);

  const ownerCap = await post(`/v1/transactions/${t1}/capture`, owner.cookie);
  assert.equal(ownerCap.statusCode, 200, ownerCap.body);
});
