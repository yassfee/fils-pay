/**
 * Tests for runConsumerPass: the transactional
 * atomicity claim (a mid-batch throw rolls back the WHOLE pass — neither the
 * watermark nor any rollup write from that batch persists), and an
 * end-to-end pass over real events enqueued via @filspay/events'
 * enqueueEvent with the exact payload shapes capture.ts/void.ts and
 * CloseBatch produce. Requires DATABASE_URL to point at a real, migrated
 * Postgres (run `npm run migrate` first).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { runConsumerPass, CONSUMER_NAME } from "./runConsumerPass.js";
import { advanceCursor, readCursor } from "./cursor.js";
import { applyEvent, type OutboxEventRow } from "./applyEvent.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("runConsumerPass.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)");
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const config = { consumerBatchLimit: 500 };

test.after(async () => {
  await pool.end();
});

async function createMerchant(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`runConsumerPass Test Merchant ${label} ${randomUUID()}`, 250],
  );
  return result.rows[0]!.id;
}

async function getCursor(): Promise<bigint> {
  const result = await pool.query<{ last_processed_id: string }>(
    `SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = $1`,
    [CONSUMER_NAME],
  );
  return result.rows[0] ? BigInt(result.rows[0].last_processed_id) : 0n;
}

test("runConsumerPass: end-to-end over real events with the producers' exact payload shapes populates merchant_daily_volume and advances the watermark", async () => {
  const merchantId = await createMerchant("e2e-volume");
  const txnId = randomUUID();

  const capturedEvent = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: txnId,
    payload: { merchantId, amountCapturedFils: 6_000, feeFils: 90, newStatus: "captured", capturedTotalFils: 6_000 },
  });
  const voidedTxnId = randomUUID();
  const voidedEvent = await enqueueEvent(pool, {
    eventType: "transaction.voided",
    aggregateType: "transaction",
    aggregateId: voidedTxnId,
    payload: { merchantId },
  });

  const before = await getCursor();
  const { processedCount } = await runConsumerPass(pool, config);
  assert.ok(processedCount >= 2, "at least this test's two events were processed (shared DB across the suite)");

  const after = await getCursor();
  assert.ok(after > before, "watermark advanced");
  assert.ok(after >= voidedEvent.id, "watermark reached at least this pass's highest id");
  assert.ok(voidedEvent.id > capturedEvent.id);

  const volumeDate = capturedEvent.createdAt.toISOString().slice(0, 10); // UTC same-day at test time in practice
  const result = await pool.query(
    `SELECT captured_count, captured_gross_fils, voided_count FROM merchant_daily_volume WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].captured_count, 1);
  assert.equal(Number(result.rows[0].captured_gross_fils), 6_000);
  assert.equal(result.rows[0].voided_count, 1);
  void volumeDate;

  const cursorRow = await pool.query<{ updated_at: Date }>(
    `SELECT updated_at FROM reporting_outbox_cursor WHERE consumer_name = $1`,
    [CONSUMER_NAME],
  );
  assert.ok(cursorRow.rows[0]!.updated_at.getTime() <= Date.now());
});

test("runConsumerPass: end-to-end settlement.batch_closed populates merchant_payout_trends", async () => {
  const merchantId = await createMerchant("e2e-payout");
  const batchResult = await pool.query<{ id: string }>(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at, paid_at)
     VALUES ($1, '2026-02-01', 'paid', 8_000, 200, 7_800, now(), now())
     RETURNING id`,
    [merchantId],
  );
  const batchId = batchResult.rows[0]!.id;

  await enqueueEvent(pool, {
    eventType: "settlement.batch_closed",
    aggregateType: "settlement_batch",
    aggregateId: batchId,
    payload: { merchantId, batchId, batchDate: "2026-02-01", grossFils: 8_000, feeFils: 200, netPayoutFils: 7_800 },
  });

  await runConsumerPass(pool, config);

  const result = await pool.query(
    `SELECT status, gross_fils, fee_fils, net_payout_fils FROM merchant_payout_trends WHERE merchant_id = $1 AND settlement_batch_id = $2`,
    [merchantId, batchId],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "paid");
  assert.equal(Number(result.rows[0].gross_fils), 8_000);
  assert.equal(Number(result.rows[0].fee_fils), 200);
  assert.equal(Number(result.rows[0].net_payout_fils), 7_800);
});

// MK: this is the proof exactly-once holds.
test("runConsumerPass: atomicity — an apply failure partway through a multi-event batch rolls back the WHOLE pass, neither watermark nor any rollup write from that batch persists", async () => {
  const merchantId = await createMerchant("atomicity");

  // Event 1: valid, would successfully write a merchant_daily_volume row if
  // applied on its own.
  const goodEvent = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 1_234, feeFils: 18, newStatus: "captured", capturedTotalFils: 1_234 },
  });

  // Event 2: malformed — missing merchantId entirely, so
  // applyTransactionVoided's INSERT sends a NULL into
  // merchant_daily_volume.merchant_id, violating its NOT NULL constraint
  // and throwing partway through the batch (event 2 of 2, ordered by id).
  const badEvent = await enqueueEvent(pool, {
    eventType: "transaction.voided",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: {}, // no merchantId
  });
  assert.ok(badEvent.id > goodEvent.id, "bad event sorts after the good one, so the good one is applied first");

  const cursorBefore = await getCursor();

  await assert.rejects(runConsumerPass(pool, config));

  const cursorAfter = await getCursor();
  assert.equal(cursorAfter, cursorBefore, "watermark must be completely untouched after a rolled-back pass");

  const volumeRows = await pool.query(`SELECT * FROM merchant_daily_volume WHERE merchant_id = $1`, [merchantId]);
  assert.equal(volumeRows.rows.length, 0, "the good event's rollup write must NOT have persisted — the whole pass rolled back");

  // Prove the pass is retryable and self-heals once the poisoned row is no
  // longer in the way: delete the malformed event, retry, and confirm the
  // good event (still unprocessed, since the watermark never advanced past
  // it) is now correctly applied.
  await pool.query(`DELETE FROM outbox_events WHERE id = $1`, [badEvent.id]);
  const retryResult = await runConsumerPass(pool, config);
  assert.ok(retryResult.processedCount >= 1);

  const volumeRowsAfterRetry = await pool.query(`SELECT captured_count FROM merchant_daily_volume WHERE merchant_id = $1`, [
    merchantId,
  ]);
  assert.equal(volumeRowsAfterRetry.rows.length, 1);
  assert.equal(volumeRowsAfterRetry.rows[0].captured_count, 1);

  const cursorFinal = await getCursor();
  assert.ok(cursorFinal >= goodEvent.id, "watermark now past the previously-blocked good event");
});

// OBX-DOUBLE / FP-300 ☐5: catch-up beside the live worker (RUNBOOK), rebuild, or two containers overlapping in a
// deploy run concurrent passes; each event must still be applied exactly once.
test("runConsumerPass: a pass overlapping another in-flight pass does not re-apply the same events", async () => {
  await runConsumerPass(pool, config);
  const merchantId = await createMerchant("overlapping-passes");
  const event = await enqueueEvent(pool, {
    eventType: "transaction.captured",
    aggregateType: "transaction",
    aggregateId: randomUUID(),
    payload: { merchantId, amountCapturedFils: 1_000, feeFils: 25, newStatus: "captured", capturedTotalFils: 1_000 },
  });
  const clientA = await pool.connect();
  try {
    await clientA.query("BEGIN");
    await readCursor(clientA, CONSUMER_NAME); // pass A has read the watermark and is mid-batch
    const passB = runConsumerPass(pool, config);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rows = await clientA.query<OutboxEventRow>(
      `SELECT id, event_type, aggregate_id, payload, created_at FROM outbox_events WHERE id = $1`,
      [String(event.id)],
    );
    await applyEvent(clientA, rows.rows[0]!);
    await advanceCursor(clientA, CONSUMER_NAME, BigInt(event.id));
    await clientA.query("COMMIT");
    await passB;
  } finally {
    clientA.release();
  }
  const volume = await pool.query(`SELECT captured_count FROM merchant_daily_volume WHERE merchant_id = $1`, [merchantId]);
  assert.equal(Number(volume.rows[0].captured_count), 1);
});

// OBX-SKIP (FP-300 ☐5): ids are taken at INSERT, not COMMIT. A lower id that commits after a higher id has been
// consumed must still be applied; an id watermark skipped it forever.
test("OBX-SKIP: an event whose transaction commits after a higher id was consumed is still applied", async () => {
  await runConsumerPass(pool, config);
  const lateMerchant = await createMerchant("late-commit");
  const earlyMerchant = await createMerchant("early-commit");
  const clientA = await pool.connect();
  try {
    await clientA.query("BEGIN");
    const late = await enqueueEvent(clientA, {
      eventType: "transaction.captured",
      aggregateType: "transaction",
      aggregateId: randomUUID(),
      payload: { merchantId: lateMerchant, amountCapturedFils: 25_000, feeFils: 625, newStatus: "captured", capturedTotalFils: 25_000 },
    });
    const early = await enqueueEvent(pool, {
      eventType: "transaction.captured",
      aggregateType: "transaction",
      aggregateId: randomUUID(),
      payload: { merchantId: earlyMerchant, amountCapturedFils: 1_000, feeFils: 25, newStatus: "captured", capturedTotalFils: 1_000 },
    });
    assert.ok(early.id > late.id, "the uncommitted event holds the lower id");
    await runConsumerPass(pool, config); // NOTIFY from the committed higher id fires this pass
    await clientA.query("COMMIT");
  } finally {
    clientA.release();
  }
  await runConsumerPass(pool, config);
  for (const merchantId of [lateMerchant, earlyMerchant]) {
    const volume = await pool.query(`SELECT captured_count FROM merchant_daily_volume WHERE merchant_id = $1`, [merchantId]);
    assert.equal(volume.rows.length, 1, `merchant ${merchantId === lateMerchant ? "late" : "early"} must have its capture rolled up`);
    assert.equal(Number(volume.rows[0].captured_count), 1);
  }
});

// OBX-SKIP follow-up: rows that existed before migration 0100 are never NULL. ADD COLUMN ... NOT NULL DEFAULT
// pg_current_xact_id() backfills each with the migration's own txid, which the stored watermark row shares, so the
// unprocessed ones sort after it and are consumed. Simulated here by a row inserted with the watermark row's txid.
test("OBX-SKIP: txid is NOT NULL with a default, and a pre-0100 row sharing the watermark's backfilled txid is still applied", async () => {
  const column = await pool.query<{ is_nullable: string; column_default: string | null }>(
    `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'outbox_events' AND column_name = 'txid'`,
  );
  assert.deepEqual(column.rows[0], { is_nullable: "NO", column_default: "pg_current_xact_id()" });

  const merchantId = await createMerchant("pre-0100-row");
  await runConsumerPass(pool, config);
  const watermarkRow = await pool.query<{ txid: string }>(
    `SELECT o.txid::text FROM outbox_events o JOIN reporting_outbox_cursor c ON c.last_processed_id = o.id WHERE c.consumer_name = $1`,
    [CONSUMER_NAME],
  );
  await pool.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, txid)
     VALUES ('transaction.captured', 'transaction', $1, $2, $3::xid8)`,
    [randomUUID(), { merchantId, amountCapturedFils: 3_000, feeFils: 75, newStatus: "captured", capturedTotalFils: 3_000 }, watermarkRow.rows[0]!.txid],
  );
  await runConsumerPass(pool, config);
  const volume = await pool.query(`SELECT captured_count FROM merchant_daily_volume WHERE merchant_id = $1`, [merchantId]);
  assert.equal(Number(volume.rows[0]?.captured_count), 1, "the backfilled-txid row after the watermark is applied");
});
