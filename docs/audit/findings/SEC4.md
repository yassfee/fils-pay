### SEC4 · API responses carry no nosniff, no-store or anti-framing headers · · Severity: Low

**Lead:** Team 45 heads-up list (SEC4), verified by us.

**What's wrong:** No response from the API sets `X-Content-Type-Options`, `Cache-Control`, `X-Frame-Options` or a `Content-Security-Policy` `frame-ancestors`. Authenticated JSON (balances, transactions, payouts, API-key lists, the merchant's own session data) can be stored by browser and proxy caches, KYC documents served with their stored MIME type can be content-sniffed, and any API page can be framed by another origin.

**Why it happens:** `apps/api/src/app.ts:41-51` builds the Fastify instance with cookies, multipart and the error handler only. There is no helmet-style plugin and no hook that sets response headers, and no route sets them itself (grep for `cache-control`, `nosniff`, `x-frame` in `apps/api/src` finds nothing).

**What it breaks:** a shared or back-office machine keeps a merchant's `GET /v1/transactions`, `/v1/settlement/...` or `/v1/merchants/:id/api-keys` responses in its HTTP cache after logout (no `no-store`), where the next user of the browser profile or an intermediary can read them. Without `nosniff`, a KYC upload whose bytes look like HTML or script can be sniffed and rendered as such by older browsers when opened inline. Without anti-framing headers, API-origin responses can be embedded for click-jacking or UI redress.

**Why it needed a fix:** the security review checks the OWASP secure-headers baseline for an authenticated payments API; these are the headers that keep cookie-authenticated financial data out of caches and frames.

**Fix:** `apps/api/src/app.ts:52-55`
```diff
   app.setErrorHandler(errorHandler);
+  app.addHook("onSend", async (_request, reply) => { // SEC4: API responses are never sniffed, framed or cached
+    reply.header("x-content-type-options", "nosniff").header("x-frame-options", "DENY").header("content-security-policy", "frame-ancestors 'none'");
+    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
+  });
```
One root-level `onSend` hook, so it covers every route, including error responses. `Cache-Control: no-store` is only set when a route has not chosen its own policy.

**Why this is the smallest correct fix:** one hook at the single place every response passes. *Why not add `@fastify/helmet`?* A new dependency and its default CSP (`default-src 'self'`) is a policy change beyond these four headers. *Why not per route?* Dozens of routes and every new one would forget it. *Why not `no-store` only on authenticated routes?* The public payment-link read returns a link's live status, which must not be cached either, and the hook stays one line. *CORS:* the API registers no CORS plugin and the hook adds no `Access-Control-*` header, so cross-origin behaviour is unchanged; no UI frames an API response (grep for `iframe`/`embed`/`object` in `apps/web` and `apps/admin` finds nothing).

**Proof:** `SEC4: responses carry nosniff, no-store and frame-ancestors headers` (`apps/api/src/routes/securityHeaders.audit.test.ts`). Before the fix: `x-content-type-options` was `undefined`. After: passes.

**Regression risk:** headers only; status codes and bodies are unchanged, so checkout and load-test behaviour are the same. `app.test.ts`, `routes/health.test.ts`, `routes/paymentLinks.test.ts`, `routes/transactions.test.ts` and `routes/acquirerCallbacks.test.ts` pass (45/45).

Lines: prod +4/-0, test +52/-0
