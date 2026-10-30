// VOL-1 audit: the API-side tier read must still apply above 2^31-1 fils
// (money is integer fils in BIGINT; case file, ADR-0001). Before migration
// 0082 the INT4 column rejected 3,000,000,000 with "integer out of range".
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { getVolumeTierBonusBps } from "./platformVolumeTier.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

test("VOL-1: a counter of 3,000,000,000 fils is stored and keeps the 15 bps tier", async () => {
  await pool.query(`UPDATE platform_stats SET total_processed_fils = 3000000000 WHERE id = 1`);
  const client = await pool.connect();
  try {
    assert.equal(await getVolumeTierBonusBps(client), 15);
  } finally {
    client.release();
    await pool.query(`UPDATE platform_stats SET total_processed_fils = 0 WHERE id = 1`);
    await pool.end();
  }
});
