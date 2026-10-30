import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// UI-401: when the admin session ends, an admin page sends the operator to the login page instead of
// showing a raw "unauthenticated". The login page itself never redirects (a wrong password is a 401
// there). Loaded through Vite: client.ts reads import.meta.env.
test("a 401 on an admin page redirects to the login page, but not on the login page", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  const realFetch = globalThis.fetch;
  const assigned: string[] = [];
  const location = { pathname: "/merchants", assign: (url: string) => void assigned.push(url) };
  try {
    const { request } = (await vite.ssrLoadModule("/src/api/client.ts")) as { request: (path: string) => Promise<unknown> };
    Object.assign(globalThis, { location });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 });
    await assert.rejects(request("/v1/admin/merchants"));
    assert.deepEqual(assigned, ["/login"]);
    location.pathname = "/login";
    await assert.rejects(request("/v1/admin/auth/login"));
    assert.deepEqual(assigned, ["/login"], "no redirect from the login page");
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { location?: unknown }).location;
    await vite.close();
  }
});
