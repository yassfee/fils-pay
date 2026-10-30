### API-1 · A malformed, empty, oversized or non-JSON request body is a 500 on every route · (no case ref; plainly invalid input must be a 4xx, same class as ERR-1/SEC-1) · Severity: Low

**What's wrong:** any POST/PATCH whose body Fastify cannot parse answered `500 internal_error` and logged an "unhandled error": `{bad` with `Content-Type: application/json`, an empty JSON body (common on a DELETE sent with a JSON content type), an `application/xml` body, and a body over the 1 MiB limit. That includes the public `POST /v1/auth/login` and signup.

**Why it happens:** Fastify rejects these bodies itself with errors that already carry the right status (`FST_ERR_CTP_INVALID_JSON_BODY`/`FST_ERR_CTP_EMPTY_JSON_BODY` 400, `FST_ERR_CTP_BODY_TOO_LARGE` 413, `FST_ERR_CTP_INVALID_MEDIA_TYPE` 415). The custom `errorHandler` (`apps/api/src/plugins/errorHandler.ts`) maps only `AppError`, schema validation, two multipart codes and three Postgres codes; every other error, including these, falls through to the generic `reply.code(500)` and the `statusCode` Fastify set is discarded.

**What it breaks:** a client bug (bad JSON, wrong content type) looks like a server outage: monitoring sees 500s and error logs that anyone on the internet can generate on the login route, and the client gets no hint that its request was malformed.

**Why it needed a fix:** malformed client input is a 4xx by HTTP semantics and by the API's own error contract (the errorHandler docblock: "every expected error" maps to `{error, message}` with its status; ERR-1 and SEC-1 fixed the same class for other inputs).

**Fix:** `apps/api/src/plugins/errorHandler.ts`, just before the generic 500:
```diff
+  // API-1: Fastify's own body-parser errors (malformed/empty JSON 400, 413, 415) already carry their 4xx status
+  if (typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
+    reply.code(fastifyErr.statusCode).send({ error: "invalid_request", message: fastifyErr.message });
+    return;
+  }
```

**Why this is the smallest correct fix:** the error handler is the single place every route's errors pass through, and Fastify has already decided the status. *Why not a custom JSON content-type parser?* It would cover only one of the four cases and re-implement Fastify's parser. *Why not list the four FST codes?* Fastify raises other 4xx client errors too (e.g. an invalid content-length); honouring its status is the general rule, and only errors that carry an explicit 4xx `statusCode` are affected: `AppError`s are handled earlier, and pg and runtime errors carry no `statusCode`, so real server faults still log and return 500.

**Proof:** `API-1: a malformed, empty, oversized or non-JSON request body is a 4xx, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500` (`POST /v1/auth/login` with `{bad`), and passes after: 400, 400, 415 and 413 on both `/v1/auth/login` and `POST /v1/merchants`.

**Regression risk:** only responses that were 500 for a client-side body error change, to the status Fastify assigned. `src/app.test.ts` and `src/routes/auth.audit.test.ts` pass (20/20).

Lines: prod +6/-0 (a comment, 4 code lines, a blank line), test +43/-0
