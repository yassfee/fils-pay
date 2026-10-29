/**
 * Audit regression tests for merchant session lookup (AUTH-1, case refs G4/H8).
 * Requires DATABASE_URL to point at a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { lookupSession } from "./sessions.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
test.after(async () => {
  await pool.end();
});

// AUTH-1 (G4, H8): the cookie /login sets after the password step is a pending
// session (authenticated = false). It must authenticate nothing until OTP verify.
test("AUTH-1: lookupSession returns null for a pending (pre-OTP) session", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Audit AUTH-1 ${randomUUID().slice(0, 8)}`],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, password_hash, role)
     VALUES ($1, $2, 'unused', 'owner') RETURNING id`,
    [merchant.rows[0]!.id, `auth1-${randomUUID()}@audit.test`],
  );
  const rawToken = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at)
     VALUES ($1, $2, false, now() + interval '10 minutes')`,
    [user.rows[0]!.id, sha256Hex(rawToken)],
  );

  assert.equal(await lookupSession(pool, rawToken), null, "a pending session must not authenticate");
});
