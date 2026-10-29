/**
 * FP-300 box 5 (reports): GET /v1/analytics/volumes returns the refund rollup
 * (refund_count, refund_gross_fils) that the reporting consumer writes to
 * merchant_daily_volume. Real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("analytics.refunds.audit.test.ts requires DATABASE_URL (a migrated Postgres)");
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

test("FP-300: GET /v1/analytics/volumes returns refundCount and refundGrossFils for the Bahrain day", async () => {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 275) RETURNING id`,
    [`Refund Analytics ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "analytics" });
  await pool.query(
    `INSERT INTO merchant_daily_volume (merchant_id, volume_date, captured_count, captured_gross_fils, refund_count, refund_gross_fils)
     VALUES ($1, '2026-10-30', 1, 10000, 2, 4333)`,
    [merchantId],
  );

  const res = await app.inject({
    method: "GET",
    url: "/v1/analytics/volumes?from=2026-10-30&to=2026-10-31",
    headers: { authorization: `Bearer ${rawKey}` },
  });
  assert.equal(res.statusCode, 200, res.body);
  const points = (res.json() as { points: Array<Record<string, unknown>> }).points;
  assert.equal(points.length, 1);
  assert.equal(points[0]!.date, "2026-10-30");
  assert.equal(points[0]!.refundCount, 2);
  assert.equal(points[0]!.refundGrossFils, 4_333);
});
