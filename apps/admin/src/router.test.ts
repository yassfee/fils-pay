import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// ROUTER-404: an unknown admin URL gets a page of its own, and every page subtree has an errorElement,
// so neither a typo nor a render crash shows React Router's developer error screen.
// Loaded through Vite because the API client reads import.meta.env; a minimal window/document stub
// is enough for createBrowserRouter to match locations.
test("an unknown admin URL matches the catch-all route, and every subtree has an errorElement", async () => {
  const history = { state: null, length: 1, replaceState() {}, pushState() {} };
  const window = { location: new URL("http://localhost:5174/no-such-page"), history, addEventListener() {}, removeEventListener() {} };
  Object.assign(globalThis, { window, document: { defaultView: window } });
  const root = fileURLToPath(new URL("..", import.meta.url));
  const vite = await createServer({ root, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
  try {
    const { router } = (await vite.ssrLoadModule("/src/router.tsx")) as {
      router: { state: { errors: unknown; matches: { route: { path?: string } }[] }; routes: { path?: string; errorElement?: unknown }[] };
    };
    assert.equal(router.state.errors, null, "an unknown URL must match the catch-all route");
    assert.equal(router.state.matches.at(-1)?.route.path, "*");
    for (const route of router.routes) {
      assert.ok(route.errorElement, `route ${route.path ?? "(layout)"} needs an errorElement`);
    }
  } finally {
    await vite.close();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  }
});
