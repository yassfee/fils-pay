import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("migrate_concurrent.audit.test.ts requires DATABASE_URL (a local test server)");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function runMigrate(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "db/migrate.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    child.on("exit", (code) => resolve(code));
  });
}

// G12: two deploy replicas (or a retried pipeline step) run db/migrate.ts at the same time on an empty
// database. Before the fix the second runner raced the first on the bootstrap table and exited 1.
test("G12: two concurrent migration runs on a fresh database both succeed", { timeout: 600_000 }, async () => {
  const name = `filspay_g12_${randomUUID().replace(/-/g, "")}`;
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  try {
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    const codes = await Promise.all([runMigrate(url.toString()), runMigrate(url.toString())]);
    assert.deepEqual(codes, [0, 0]);
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
