import assert from "node:assert/strict";
import { test } from "node:test";
import { toFils } from "@filspay/money";
import { createAcquirerSimulator } from "./simulator.js";

// REF-6 follow-up (FP-209/FP-300): 'error' means the outcome is unknown (transport failure).
// Once REF-6 made the refund key stable across retries, caching 'error' meant a same-key
// retry replayed 502 forever, so a refund that failed transiently could never complete.
test("a refund that errored is really retried under the same idempotency key", async () => {
  const config = { acquirerLatencyMinMs: 0, acquirerLatencyMaxMs: 1, acquirerFailureRate: 1, acquirerRngSeed: 7 };
  const sim = createAcquirerSimulator(config);
  let erroredKey = "";
  for (let i = 0; i < 50 && !erroredKey; i++) {
    const r = await sim.refund({ acquirerReference: "acq-1", amountFils: toFils(1000), idempotencyKey: `k-${i}` });
    if (r.outcome === "error") erroredKey = `k-${i}`;
  }
  assert.ok(erroredKey, "the seeded roll should produce an 'error' outcome");

  config.acquirerFailureRate = 0; // the transient fault is gone
  const retry = await sim.refund({ acquirerReference: "acq-1", amountFils: toFils(1000), idempotencyKey: erroredKey });
  assert.equal(retry.outcome, "approved");
});
