import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("dateInput.audit.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

async function ownerCookie(): Promise<string> {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`Dates ${randomUUID()}`]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [m.rows[0]!.id, `owner-${randomUUID()}@example.test`],
  );
  const raw = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at) VALUES ($1, $2, true, now() + interval '10 minutes')`,
    [u.rows[0]!.id, sha256Hex(raw)],
  );
  return `${config.cookieName}=${raw}`;
}

async function statuses(urls: string[]): Promise<string[]> {
  const cookie = await ownerCookie();
  const seen: string[] = [];
  for (const url of urls) {
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    seen.push(`${url} -> ${res.statusCode}`);
  }
  return seen;
}

// HUNT-1: a malformed or impossible date in a query string reached Postgres, whose 22007/22008 became a 500.
test("HUNT-1: a malformed date query parameter is a 400, not a 500", async () => {
  const urls = [
    "/v1/transactions?from=garbage",
    "/v1/transactions/export?to=2026-13-01",
    "/v1/settlement/batches?from=garbage",
    "/v1/analytics/volumes?from=2026-02-30",
  ];
  assert.deepEqual(await statuses(urls), urls.map((u) => `${u} -> 400`));
});
