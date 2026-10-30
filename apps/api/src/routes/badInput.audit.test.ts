/**
 * Plainly invalid client input must be a 4xx, never a 500 (lane H; same class as ERR-1, SEC-1, IMP-4, HUNT-1).
 * Uses the real buildApp() and a real, migrated Postgres.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

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
