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
    // Every admin role maps to the merchant role "support", so owner/finance-gated reads are refused too.
    const gated = await app.inject({ method: "GET", url: "/v1/settlement/reconciliation?from=2026-10-01&to=2026-10-02", headers: { cookie } });
    assert.equal(gated.statusCode, 403, `owner/finance-gated read: ${gated.body}`);

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

// ADMIN-IMP-2 (H3): a grant must die with its admin's standing. Disabling the admin (which already
// kills their sessions, adminAuth/sessions.ts) or logging out must also end their grants.
test("ADMIN-IMP-2: a grant stops resolving once its admin is disabled or logs out", async () => {
  const { lookupImpersonationGrant } = await import("./impersonation.js");
  const { revokeAdminSession } = await import("../adminAuth/sessions.js");
  const merchant = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [
    `Audit IMP2 ${randomUUID().slice(0, 8)}`,
  ]);
  async function adminWithGrant() {
    const a = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, 'unused', 'IMP2', 'super_admin') RETURNING id`,
      [`imp2-${randomUUID()}@admin.test`],
    );
    const grant = await startImpersonation(pool, { adminUserId: a.rows[0]!.id, merchantId: merchant.rows[0]!.id, ttlMinutes: 30 });
    assert.ok(await lookupImpersonationGrant(pool, grant.rawToken), "fresh grant must resolve");
    return { adminUserId: a.rows[0]!.id, rawToken: grant.rawToken };
  }

  const disabled = await adminWithGrant();
  await pool.query(`UPDATE admin_users SET status = 'disabled' WHERE id = $1`, [disabled.adminUserId]);
  assert.equal(await lookupImpersonationGrant(pool, disabled.rawToken), null, "a disabled admin's grant still resolves");

  const loggedOut = await adminWithGrant();
  const s = await pool.query<{ id: string }>(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, authenticated, expires_at) VALUES ($1, $2, true, now() + interval '1 hour') RETURNING id`,
    [loggedOut.adminUserId, randomUUID()],
  );
  await revokeAdminSession(pool, s.rows[0]!.id);
  assert.equal(await lookupImpersonationGrant(pool, loggedOut.rawToken), null, "the grant survives the admin's logout");
});
