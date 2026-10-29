/**
 * FP-300 box 4: a real refund (POST /v1/refunds) produces a refund.succeeded outbox event that
 * the dispatcher delivers to the merchant's endpoint, and a receiver can verify the signature as
 * HMAC-SHA256 over `${t}.${raw body bytes}` with the endpoint secret, in constant time, with a
 * fresh timestamp. Real, migrated Postgres; the transport is the dispatcher tests' capture pattern.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { WEBHOOK_DELIVERY_ID_HEADER, WEBHOOK_SIGNATURE_HEADER } from "./headers.js";
import type { WebhookTransport, WebhookTransportRequest } from "./transport.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("refundWebhook.audit.test.ts requires DATABASE_URL (a migrated Postgres)");
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  WEBHOOK_MAX_ATTEMPTS: "3",
});
const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const app = buildApp(config, pool);
test.after(async () => {
  await app.close();
  await pool.end();
});

/** What a merchant's receiver does: HMAC over the exact bytes received, constant-time compare, freshness. */
function receiverVerifies(rawBody: Buffer, header: string, secret: string, nowSec: number): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  if (Math.abs(nowSec - Number(m[1])) > 300) return false; // 5-minute replay window
  const expected = createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${m[1]}.`), rawBody])).digest();
  const given = Buffer.from(m[2]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

test("FP-300: a refund's refund.succeeded webhook is delivered and its HMAC verifies over the raw bytes", async () => {
  const mr = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Refund Webhook ${randomUUID()}`],
  );
  const merchantId = mr.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "webhook" });
  const post = async (url: string, payload: object) => {
    const res = await app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
      payload,
    });
    assert.ok(res.statusCode < 300, `${url}: ${res.statusCode} ${res.body}`);
    return res.json() as { id: string; feeReversedFils: number };
  };
  const txn = await post("/v1/transactions", { amountFils: 10_000, card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" } });
  await post(`/v1/transactions/${txn.id}/capture`, {});
  const endpointUrl = `http://fake-receiver.test/refund-${randomUUID()}`;
  const endpoint = await createWebhookEndpoint(pool, config, {
    merchantId,
    url: endpointUrl,
    createdByType: "merchant_session",
    createdById: randomUUID(),
  });
  const refund = await post("/v1/refunds", { transactionId: txn.id, amountFils: 4_000 });

  const received: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = async (req) => {
    if (req.url === endpointUrl) received.push(req);
    return { statusCode: 200, body: "ok" };
  };
  await runDispatchPass(pool, transport, config);

  assert.equal(received.length, 1, "exactly one delivery to this endpoint: the refund");
  const req = received[0]!;
  const rawBody = Buffer.from(req.body, "utf8"); // the exact bytes on the wire
  const body = JSON.parse(rawBody.toString("utf8")) as { id: string; type: string; data: Record<string, unknown> };
  assert.equal(body.type, "refund.succeeded");
  assert.equal(body.id, req.headers[WEBHOOK_DELIVERY_ID_HEADER]);
  assert.equal(body.data.refundId, refund.id);
  assert.equal(body.data.transactionId, txn.id);
  assert.equal(body.data.amountFils, 4_000);
  assert.equal(body.data.feeReversedFils, refund.feeReversedFils);

  const header = req.headers[WEBHOOK_SIGNATURE_HEADER]!;
  const now = Math.floor(Date.now() / 1000);
  assert.equal(receiverVerifies(rawBody, header, endpoint.secret, now), true, "signature verifies over the raw bytes");
  const tampered = Buffer.from(rawBody);
  tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 1;
  assert.equal(receiverVerifies(tampered, header, endpoint.secret, now), false, "one flipped byte fails");
  assert.equal(receiverVerifies(rawBody, header, endpoint.secret, now + 3_600), false, "a stale timestamp fails");

  const delivery = await pool.query<{ status: string }>(
    `SELECT status FROM webhook_deliveries WHERE endpoint_id = $1 AND replay_of_delivery_id IS NULL`,
    [endpoint.id],
  );
  assert.deepEqual(delivery.rows.map((d) => d.status), ["succeeded"]);
});
