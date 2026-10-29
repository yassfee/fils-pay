### CW-7 · Inbound acquirer HMAC is computed over re-serialized JSON, with no freshness check · FP-240, FP-201 · Severity: Medium

**What's wrong:** The callback verifier hashed `${t}.${JSON.stringify(request.body)}` (Fastify's parsed object re-serialized by V8), not the bytes the acquirer signed; `t` was never compared with the clock; and the comparison (`constantTimeEquals`) was an early-exit `Buffer.compare`.

**Why it happens:** `apps/api/src/webhooks/inboundVerify.ts:61-63` re-stringified the parsed body passed from `routes/acquirerCallbacks.ts:57-58`; `inboundVerify.ts:32` states "freshness is not checked"; `:40-43` hand-rolled a non-constant-time compare although `lib/crypto.ts:14-21` has `timingSafeEqualHex`. Hidden by both test helpers (`inboundVerify.test.ts:16`, `routes/acquirerCallbacks.test.ts:63`), which signed `JSON.stringify(body)` themselves and so could never see a byte mismatch, and `acquirerCallbacks.test.ts:103` ("stale timestamp … not covered").

**What it breaks:** A genuine verdict serialized as `{"callbackId": "…", "note": "…"}` (Python/Go separators or escaping, e.g. Go turns `&` into `\u0026`) is rejected 401 on every retry and lost; a sniffed callback with `t=1757930000` is accepted forever (FP-201 replay, compounded by CW-5).

**Why it needed a fix:** FP-240 requires signed callbacks with replay protection; today correct acquirers fail and replays succeed.

**Fix:** `apps/api/src/routes/acquirerCallbacks.ts:41-47` adds a plugin-scoped (encapsulated) `application/json` parser that keeps `rawBody` and delegates to Fastify's default JSON parser; `:63` passes `rawBody`. `apps/api/src/webhooks/inboundVerify.ts`: param `payload: unknown` → `rawBody: string`, HMAC over `${t}.${rawBody}`, `timingSafeEqualHex` instead of `constantTimeEquals` (deleted), and a 300 s tolerance check returning the new reason `timestamp_out_of_tolerance` (same window as outbound `sign.ts:101`).
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
-/** There is no timestamp reason: freshness is not checked for inbound callbacks. */
-export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch";
+/** CW-7: freshness is checked (300 s), like the outbound scheme in sign.ts. */
+export type VerifyAcquirerCallbackFailureReason = "malformed_header" | "signature_mismatch" | "timestamp_out_of_tolerance";
-function constantTimeEquals(a: string, b: string): boolean {
-  return Buffer.from(a).length === Buffer.from(b).length &&
-    Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
-}
-
-  payload: unknown,
+  rawBody: string,
-    .update(`${parsed.timestamp}.${JSON.stringify(payload)}`)
+    .update(`${parsed.timestamp}.${rawBody}`) // CW-7: the exact bytes the acquirer signed
-  if (!constantTimeEquals(expected, parsed.signature)) {
+  if (!timingSafeEqualHex(expected, parsed.signature)) {
+  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > 300) return { valid: false, reason: "timestamp_out_of_tolerance" };
```
Commit: this commit. Lines: prod +15/-10, test +45/-12.

**Why this is the smallest correct fix:** Raw bytes only exist at the Fastify parsing layer, so one encapsulated parser plus one argument is the minimum; the verifier keeps its shape (3-arg, same result type). Why not `canonicalJson` on both sides: the acquirer does not canonicalize, so still byte-mismatched. Why not a global `rawBody` plugin in `app.ts`: touches every route and a file outside this lane. The compare swap reuses the existing helper (net -3 lines).

**Proof:** `routes/acquirerCallbacks.test.ts` "verifies the raw body bytes and rejects a stale timestamp": before `expected 200, actual 401`; after passes (stale `t` → 401 `timestamp_out_of_tolerance`, 0 notes). `inboundVerify.test.ts` "the raw signed bytes verify even when not V8-compact, and a stale timestamp is rejected": fails before, passes after.

**Regression risk:** Only `/v1/acquirer/*` uses the new parser (Fastify encapsulation); `bodyLimit` and JSON error handling come from the default parser. Callers must now send a timestamp within ±300 s. Covered by `inboundVerify.test.ts`, `routes/acquirerCallbacks.test.ts`, `acquirer/callbacks.test.ts`, `sign.test.ts` (25/25), `tsc --noEmit` clean.

**Trap note:** Test helpers now sign the exact string sent with a current timestamp; the "not covered" comment at `acquirerCallbacks.test.ts:103` was corrected; `inboundVerify.ts:32` comment corrected. Still open (not fixed here, report only): `routes/acquirerCallbacks.ts:23` "A repeated header uses the first value" is false (Node joins duplicate custom headers with ", " so the parser keeps the last `t=`/`v1=`).
