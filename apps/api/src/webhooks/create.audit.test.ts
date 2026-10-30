/**
 * CW-4 audit: merchant webhook URLs must not reach internal hosts (SSRF to the
 * settlement service, Postgres, cloud metadata), and delivery must not follow
 * a redirect into them.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { validateWebhookUrl } from "./create.js";
import { createFetchTransport } from "./transport.js";

const prod = { nodeEnv: "production" } as const;

test("CW-4: production rejects loopback, private, link-local, single-label and internal hosts", () => {
  for (const u of [
    "https://169.254.169.254/latest/meta-data/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://[::ffff:10.0.0.7]/",
    "https://10.0.0.7/",
    "https://172.20.1.1/",
    "https://192.168.1.10/",
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://settlement:8091/internal/run-batch",
    "https://localhost/",
    "https://api.localhost/",
    "https://metadata.google.internal/",
  ]) {
    assert.throws(() => validateWebhookUrl(u, prod), /invalid_url/, u);
  }
  assert.equal(validateWebhookUrl("https://hooks.merchant.example.bh/fp", prod).hostname, "hooks.merchant.example.bh");
  assert.equal(validateWebhookUrl("https://10.example.com/fp", prod).hostname, "10.example.com");
  assert.equal(validateWebhookUrl("http://localhost:4000/hook", { nodeEnv: "development" }).hostname, "localhost");
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  const s = createServer(handler);
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(s)));
}

test("CW-4: delivery does not follow a redirect", async () => {
  let internalHits = 0;
  const internal = await listen((_req, res) => {
    internalHits++;
    res.end("ok");
  });
  const internalUrl = `http://127.0.0.1:${(internal.address() as AddressInfo).port}/internal`;
  const redirector = await listen((_req, res) => {
    res.writeHead(307, { location: internalUrl });
    res.end();
  });
  try {
    const res = await createFetchTransport()({
      url: `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/hook`,
      headers: { "content-type": "application/json" },
      body: "{}",
      timeoutMs: 2000,
    });
    assert.equal(internalHits, 0, "the redirect target must not be called");
    assert.equal(res.statusCode, 307);
  } finally {
    internal.close();
    redirector.close();
  }
});
