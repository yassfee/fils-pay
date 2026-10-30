import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// UI-401: when the session ends (expired, revoked, logged out in another tab), a dashboard page sends the
// merchant to the login page instead of showing a raw "unauthenticated" over stale data. Checkout
// (/pay/*) and the login page itself never redirect. Loaded through Vite: client.ts reads import.meta.env.
test("a 401 on a dashboard page redirects to the login page, but not on checkout or the login page", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  const realFetch = globalThis.fetch;
  const assigned: string[] = [];
  const location = { pathname: "/dashboard/transactions", assign: (url: string) => void assigned.push(url) };
  try {
    const { request } = (await vite.ssrLoadModule("/src/api/client.ts")) as { request: (path: string) => Promise<unknown> };
    Object.assign(globalThis, { location });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
    await assert.rejects(request("/v1/transactions"));
    assert.deepEqual(assigned, ["/dashboard/login"]);
    for (const pathname of ["/dashboard/login", "/pay/plink_test"]) {
      location.pathname = pathname;
      await assert.rejects(request("/v1/auth/me"));
    }
    assert.deepEqual(assigned, ["/dashboard/login"], "no redirect from the login page or checkout");
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { location?: unknown }).location;
    await vite.close();
  }
});
