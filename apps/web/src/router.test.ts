import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// ADMIN-IMP-3b (H3): the admin console's "View as merchant" opens the web app's base URL
// (apps/admin/src/api/client.ts WEB_BASE_URL, i.e. "/"), so "/" must lead into the dashboard, not a 404.
// Loaded through Vite because the pages' API client reads import.meta.env; a minimal window stub
// is enough for createBrowserRouter to match the current location.
test("the web root routes into the dashboard instead of a 404", async () => {
  const history = { state: null, length: 1, replaceState() {}, pushState() {} };
  const location = new URL("http://localhost:5173/");
  const window = { location, history, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { window, document: { defaultView: window } });
  const root = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { router } = (await vite.ssrLoadModule("/src/router.tsx")) as {
      router: { state: { errors: unknown; matches: { route: { element?: { props?: { to?: string } } } }[] } };
    };
    assert.equal(router.state.errors, null, "GET / must match a route");
    assert.equal(router.state.matches.at(-1)?.route.element?.props?.to, "/dashboard");
  } finally {
    await vite.close();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  }
});
