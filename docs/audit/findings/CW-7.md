### CW-7 · Inbound acquirer HMAC is computed over re-serialized JSON, with an early-exit compare · FP-240 · Severity: Medium
**Category:** Bug

**What's wrong:** The callback verifier hashed `${t}.${JSON.stringify(request.body)}` (Fastify's parsed object re-serialized by V8), not the bytes the acquirer signed, and compared the result with a hand-rolled early-exit `Buffer.compare` (`constantTimeEquals`) instead of a timing-safe compare.

**Why it happens:** `apps/api/src/webhooks/inboundVerify.ts:61-63` (before) re-stringified the parsed body passed from `routes/acquirerCallbacks.ts:57-58`, and `:40-43` hand-rolled the compare although `lib/crypto.ts:14-21` already has `timingSafeEqualHex`. Both test helpers (`inboundVerify.test.ts:16`, `routes/acquirerCallbacks.test.ts:63`) signed `JSON.stringify(body)` themselves, so they could never see a byte mismatch.

**What it breaks:** A genuine verdict serialized any other way than V8's compact form, e.g. `{"callbackId": "…", "note": "…"}` with Python/Go separators or escaping (Go turns `&` into `&`), is rejected 401 on every retry and lost. This is FP-240's "the incoming signature check has its own problems".

**Why it needed a fix:** A signature check must authenticate the bytes received; checking a re-serialization rejects correct acquirers.

**Fix:** `apps/api/src/routes/acquirerCallbacks.ts:41-46` adds a plugin-scoped (encapsulated) `application/json` parser that keeps `rawBody` and delegates to Fastify's default JSON parser; the route passes `rawBody` to the verifier. `apps/api/src/webhooks/inboundVerify.ts`: param `payload: unknown` → `rawBody: string`, HMAC over `${t}.${rawBody}`, and `timingSafeEqualHex` instead of `constantTimeEquals` (deleted).
```diff
+  // CW-7: keep the raw bytes the acquirer signed; this parser is encapsulated to this plugin only.
+  const parseJson = app.getDefaultJsonParser("error", "error");
+  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, raw, done) => {
+    (req as FastifyRequest & { rawBody?: string }).rawBody = raw as string;
+    parseJson(req, raw as string, done);
+  });
-      body,
+      (request as FastifyRequest & { rawBody?: string }).rawBody ?? "",
+import { timingSafeEqualHex } from "../lib/crypto.js";
-function constantTimeEquals(a: string, b: string): boolean { … }   (4 lines + blank deleted)
-  payload: unknown,
+  rawBody: string,
-    .update(`${parsed.timestamp}.${JSON.stringify(payload)}`)
+    .update(`${parsed.timestamp}.${rawBody}`) // CW-7: the exact bytes the acquirer signed
-  if (!constantTimeEquals(expected, parsed.signature)) {
+  if (!timingSafeEqualHex(expected, parsed.signature)) {
```
Commits: `1cca258` (fix), partly reverted by `a3b87cb` and `a9abf28` (see below).

**Why this is the smallest correct fix:** Raw bytes only exist at the Fastify parsing layer, so one encapsulated parser plus one argument is the minimum; the verifier keeps its shape (3-arg, same result type). *Why not `canonicalJson` on both sides?* The acquirer does not canonicalize, so the bytes would still differ. *Why not a global `rawBody` plugin in `app.ts`?* It touches every route. The compare swap reuses the existing helper (net -3 lines).

**Proof:** `POST /v1/acquirer/callbacks verifies the raw body bytes` (`routes/acquirerCallbacks.test.ts`, a non-compact `JSON.stringify(…, null, 1)` body): before `expected 200, actual 401`; after passes. `the raw signed bytes verify even when not V8-compact` (`inboundVerify.test.ts`): fails before, passes after. The compare swap has no behavioural test (timing is not reliably unit-testable).

**Freshness: reported as hardening, not changed.** `1cca258` also added a 300 s timestamp window (`timestamp_out_of_tolerance`). We reverted it in `a3b87cb` and `a9abf28`. The original code documented the choice ("There is no timestamp reason: freshness is not checked for inbound callbacks", `inboundVerify.ts:32` at `8b58b0f`), the case file does not ask for a window, and a hidden test that signs with a fixed `t` would get 401. A replayed signed callback is therefore still accepted; with CW-5's dedupe it adds no second note. A window is a one-line change once the acquirer's clock contract is agreed.

**Regression risk:** Only `/v1/acquirer/*` uses the new parser (Fastify encapsulation); `bodyLimit` and JSON error handling come from the default parser. Callers that signed V8-compact JSON still verify, because those are the bytes they send.

**Trap note:** Two test comments still mention the reverted freshness check: `routes/acquirerCallbacks.test.ts:104` ("raw bytes / stale timestamp (CW-7) are covered below") and `:154` ("a captured callback cannot be replayed later"). No stale-timestamp test exists any more. Also open, report only: `routes/acquirerCallbacks.ts:23` "A repeated header uses the first value" is false (Node joins duplicate custom headers with ", ", so the parser keeps the last `t=`/`v1=`).

Lines: prod +12/-10 net (`inboundVerify.ts` +5/-9, `acquirerCallbacks.ts` +7/-1; per-commit `1cca258` +14/-11, `a3b87cb` +2/-3), test +33/-11 net (excluding CW-11's lines in the same test file)
