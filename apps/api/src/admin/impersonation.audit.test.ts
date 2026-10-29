/**
 * Audit regression tests for admin "view as merchant" grants (ADMIN-IMP-1, case ref H3).
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
import { startImpersonation } from "./impersonation.js";

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: "test",
  KYC_UPLOAD_DIR: mkdtempSync(join(tmpdir(), "filspay-audit-")),
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

// ADMIN-IMP-1 (H3; ARCH §8 / impersonation.ts docstring: "a grant is view-only"):
// whatever the admin's role, an impersonation grant reads but never writes.
for (const role of ["support", "finance", "super_admin"] as const) {
  test(`ADMIN-IMP-1: a ${role} impersonation grant is read-only`, async () => {
    const merchant = await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
      [`Audit IMP ${randomUUID().slice(0, 8)}`],
    );
    const merchantId = merchant.rows[0]!.id;
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'unused', $2, $3) RETURNING id`,
      [`imp-${randomUUID()}@admin.test`, `Audit ${role}`, role],
    );
    const grant = await startImpersonation(pool, { adminUserId: admin.rows[0]!.id, merchantId, ttlMinutes: 30 });
    const cookie = `${config.impersonationCookieName}=${grant.rawToken}`;

    const read = await app.inject({ method: "GET", url: "/v1/transactions", headers: { cookie } });
    assert.equal(read.statusCode, 200, read.body);

    const link = await app.inject({
      method: "POST",
      url: `/v1/merchants/${merchantId}/payment-links`,
      headers: { cookie },
      payload: { amountFils: 1000, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    assert.equal(link.statusCode, 403, `payment-link create: ${link.body}`);

    // void has no role gate, so only a read-only grant check stops it.
    const voided = await app.inject({ method: "POST", url: `/v1/transactions/${randomUUID()}/void`, headers: { cookie } });
    assert.equal(voided.statusCode, 403, `void: ${voided.body}`);
  });
}
