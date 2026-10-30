/**
 * CAP-2: load shedding. Over the global in-flight cap the API must answer a
 * fast 503 + Retry-After BEFORE any route handler runs (so nothing is
 * written and a retried checkout cannot double-charge), never shed
 * /healthz, and admit traffic again once in-flight work finishes.
 * No database needed: the pool is never queried.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

test("CAP-2: requests over MAX_IN_FLIGHT get 503 + Retry-After before the handler runs; /healthz is never shed", async () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
    NODE_ENV: "test",
    MAX_IN_FLIGHT: "1",
    WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  });
  const pool = new Pool({ connectionString: config.databaseUrl });
  const app = buildApp(config, pool);
  let handlerRuns = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  app.post("/test-slow-write", async () => {
    handlerRuns++;
    await gate;
    return { ok: true };
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const first = fetch(`${base}/test-slow-write`, { method: "POST" });
    while (handlerRuns === 0) await new Promise((r) => setTimeout(r, 5));

    const shed = await fetch(`${base}/test-slow-write`, { method: "POST", signal: AbortSignal.timeout(2000) });
    assert.equal(shed.status, 503, "a request over the cap must be shed");
    assert.equal(shed.headers.get("retry-after"), "1");
    assert.deepEqual(await shed.json(), { error: "overloaded" });
    assert.equal(handlerRuns, 1, "a shed request must never reach its handler");

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200, "/healthz is never shed");

    release();
    assert.equal((await first).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    const after = await fetch(`${base}/test-slow-write`, { method: "POST" });
    assert.equal(after.status, 200, "capacity is released when the in-flight request completes");
    assert.equal(handlerRuns, 2);
  } finally {
    release();
    await app.close();
    await pool.end();
  }
});
