/**
 * TXN-1: a failing ROLLBACK must not replace the error that caused it, and the client whose
 * ROLLBACK failed (still in an unknown transaction state) must be destroyed, not pooled.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./withTransaction.js";

test("TXN-1: a ROLLBACK failure neither masks the original error nor returns the client to the pool", async () => {
  const rollbackErr = new Error("rollback failed: connection reset");
  const released: unknown[] = [];
  const client = {
    query: async (sql: string) => {
      if (sql === "ROLLBACK") throw rollbackErr;
      return { rows: [], rowCount: 0 };
    },
    release: (err?: unknown) => {
      released.push(err);
    },
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;

  const original = new Error("insert failed: unique violation");
  const thrown = await withTransaction(pool, async () => {
    throw original;
  }).catch((e: unknown) => e);

  assert.deepEqual({ thrown: (thrown as Error).message, released }, { thrown: original.message, released: [rollbackErr] });
});
