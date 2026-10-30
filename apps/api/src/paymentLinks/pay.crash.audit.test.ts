/**
 * CAP-6: payPaymentLink commits the capture and then, as a separate statement, marks the link paid. If the API
 * dies between the two (OOM kill, kill -9, a restart under load), the money is captured but the link stays
 * 'reserved'; after the 60 s lease anyone can pay it again with a new Idempotency-Key: two charges for one link.
 * Seen in the kill -9 overload run (docs/audit/CAPACITY.md): 3 captured transactions on links left unpaid.
 * The crash is simulated by making the process "die" when it reaches the stand-alone finalize statement.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("pay.crash.audit.test.ts requires DATABASE_URL");

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
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

test("CAP-6: a crash right after the capture commits never leaves captured money on a link that is still payable", async () => {
  const m = await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`CAP-6 ${randomUUID()}`]);
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const { rawKey } = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label: "cap-6" });
  const created = await app.inject({
    method: "POST",
    url: `/v1/merchants/${merchantId}/payment-links`,
    headers: { authorization: `Bearer ${rawKey}` },
    payload: { amountFils: 1500, reference: "cap-6", expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  assert.equal(created.statusCode, 201, created.body);
  const token = created.json().token as string;

  // The process dies when it reaches the stand-alone "mark the link paid" statement.
  const crashing = new Proxy(pool, {
    get(target, prop) {
      if (prop === "query") {
        return (text: unknown, ...rest: unknown[]) =>
          String(text).includes("SET status = 'paid'")
            ? Promise.reject(new Error("simulated crash"))
            : (target.query as (...a: unknown[]) => unknown)(text, ...rest);
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await payPaymentLink(crashing, app.acquirer, { paymentLinkReservationTimeoutSeconds: 60 }, {
    token,
    card: { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" },
    idempotencyKey: randomUUID(),
  }).catch(() => undefined);

  const { rows } = await pool.query<{ status: string; transaction_id: string | null; captured: number }>(
    `SELECT l.status, l.transaction_id,
            (SELECT count(*)::int FROM transactions t WHERE t.merchant_id = l.merchant_id AND t.status = 'captured') AS captured
       FROM payment_links l WHERE l.token = $1`,
    [token],
  );
  const after = rows[0]!;
  // Money captured <=> the link is paid with that transaction (never captured-and-still-payable).
  if (after.captured > 0) assert.equal(after.status, "paid", `captured ${after.captured} but the link is '${after.status}'`);
  else assert.notEqual(after.status, "paid");
});
