/**
 * Route tests for the public acquirer async-callback endpoint. Requires
 * DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate`
 * first).
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "acquirerCallbacks.test.ts requires DATABASE_URL to point at a real, migrated Postgres (run `npm run migrate` first)",
  );
}

const ACQUIRER_SECRET = "acqsec_route_test_secret";

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ACQUIRER_CALLBACK_SIGNING_SECRET: ACQUIRER_SECRET,
});

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function createTransaction(): Promise<string> {
  const merchantResult = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Acquirer Callback Route Merchant ${randomUUID()}`, 250],
  );
  const txnResult = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 50000, 50000, $2)
     RETURNING id`,
    [merchantResult.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  return txnResult.rows[0]!.id;
}

function callbackBody(transactionId: string, callbackId: string) {
  return {
    callbackId,
    type: "fraud_review.completed",
    transactionId,
    occurredAt: "2026-09-16T10:00:00.000Z",
    outcome: "confirmed_fraud",
    note: "Manual review flagged card testing pattern; recommend void.",
  };
}

function signatureHeader(body: unknown, secret = ACQUIRER_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body); // app.inject sends JSON.stringify(object)
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function noteCount(callbackId: string): Promise<string> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM acquirer_callback_notes WHERE callback_id = $1`,
    [callbackId],
  );
  return result.rows[0]!.count;
}

test("POST /v1/acquirer/callbacks accepts a correctly-signed callback and records the note", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;
  const body = callbackBody(transactionId, callbackId);

  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "acquirer-callback-signature": signatureHeader(body) },
    payload: body,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { received: true });
  assert.equal(await noteCount(callbackId), "1");
});

test("POST /v1/acquirer/callbacks rejects a body missing required fields", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    payload: { callbackId: `acqcb_${randomUUID()}`, type: "fraud_review.completed" },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_request");
});

/** Tamper = wrong HMAC. Missing header (CW-2) and raw bytes / stale timestamp (CW-7) are covered below. */
test("POST /v1/acquirer/callbacks rejects a tampered signature", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;
  const body = callbackBody(transactionId, callbackId);

  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "acquirer-callback-signature": signatureHeader(body, "acqsec_not_the_real_secret") },
    payload: body,
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_signature");
  assert.equal(res.json().message, "signature_mismatch");
  assert.equal(await noteCount(callbackId), "0");
});

// CW-2 / FP-240: the signature is this public endpoint's only auth; an unsigned callback must be rejected.
test("POST /v1/acquirer/callbacks rejects a callback sent without a signature header", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;

  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    payload: callbackBody(transactionId, callbackId),
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_signature");
  assert.equal(await noteCount(callbackId), "0");
});

test("POST /v1/acquirer/callbacks returns 404 for an unknown transaction id", async () => {
  const callbackId = `acqcb_${randomUUID()}`;
  const body = callbackBody(randomUUID(), callbackId);

  const res = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "acquirer-callback-signature": signatureHeader(body) },
    payload: body,
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "transaction_not_found");
});

// CW-7 / FP-240: the HMAC covers the acquirer's exact bytes, and a captured callback cannot be replayed later.
test("POST /v1/acquirer/callbacks verifies the raw body bytes", async () => {
  const transactionId = await createTransaction();
  const callbackId = `acqcb_${randomUUID()}`;
  const raw = JSON.stringify(callbackBody(transactionId, callbackId), null, 1); // not V8-compact
  const ok = await app.inject({
    method: "POST",
    url: "/v1/acquirer/callbacks",
    headers: { "content-type": "application/json", "acquirer-callback-signature": signatureHeader(raw) },
    payload: raw,
  });
  assert.equal(ok.statusCode, 200);
});

// CW-11: outcome is a TS cast only and occurredAt goes straight into a timestamptz column.
test("CW-11: a signed callback with an unknown outcome or an unparseable occurredAt is a 400 and stores nothing", async () => {
  const transactionId = await createTransaction();
  const seen: string[] = [];
  for (const override of [{ outcome: "approved" }, { occurredAt: "yesterday" }]) {
    const callbackId = `acqcb_${randomUUID()}`;
    const body = { ...callbackBody(transactionId, callbackId), ...override };
    const res = await app.inject({
      method: "POST",
      url: "/v1/acquirer/callbacks",
      headers: { "acquirer-callback-signature": signatureHeader(body) },
      payload: body,
    });
    seen.push(`${JSON.stringify(override)} -> ${res.statusCode} ${res.json().error ?? ""} notes=${await noteCount(callbackId)}`);
  }
  assert.deepEqual(seen, [
    `{"outcome":"approved"} -> 400 invalid_request notes=0`,
    `{"occurredAt":"yesterday"} -> 400 invalid_request notes=0`,
  ]);
});
