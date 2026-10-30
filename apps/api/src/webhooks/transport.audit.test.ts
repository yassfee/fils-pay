/**
 * CW-10 audit: the webhook transport keeps only a short excerpt of the
 * receiver's response (dispatcher stores left(body, 2000)), so it must not
 * buffer an arbitrarily large response body into the API's memory.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createFetchTransport } from "./transport.js";

test("CW-10: transport reads at most a few KB of a huge receiver response", async () => {
  const chunk = Buffer.alloc(64 * 1024, "a");
  const server = createServer((_req, res) => {
    res.on("error", () => {});
    res.writeHead(200, { "content-type": "text/plain" });
    let sent = 0;
    const pump = () => {
      while (sent < 64 * 1024 * 1024) {
        sent += chunk.length;
        if (!res.write(chunk)) return void res.once("drain", pump);
      }
      res.end();
    };
    pump();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const res = await createFetchTransport()({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`,
      headers: { "content-type": "application/json" },
      body: "{}",
      timeoutMs: 10_000,
    });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.length >= 2000, `excerpt must still cover the stored 2000 chars, got ${res.body.length}`);
    assert.ok(res.body.length <= 8192, `body must be capped, got ${res.body.length} chars`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
