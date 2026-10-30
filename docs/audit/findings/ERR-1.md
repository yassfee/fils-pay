### ERR-1 · A NUL byte in any request string turns into a 500 internal_error instead of a 400 ·  · Severity: Low

**Lead:** Team 45 heads-up list (SEC5), verified by us.

**What's wrong:** JSON allows `\u0000` inside strings, and Postgres `text` cannot store it. Any client string that reaches a query with a NUL byte made Postgres raise SQLSTATE 22021 ("invalid byte sequence for encoding UTF8: 0x00"), and the API answered `500 {"error":"internal_error"}` with a full stack trace in the error log. This works on any endpoint, including unauthenticated ones such as `POST /v1/auth/login`.

**Why it happens:** `apps/api/src/plugins/errorHandler.ts:16-35` maps `AppError`, Fastify validation errors and multipart limits. Every other error, including a `pg` `DatabaseError` caused purely by client input, falls through to the 500 branch (`:34-35`). No route rejects control characters, and none needs to as long as the database's own refusal is mapped correctly.

**What it breaks:** `POST /v1/auth/login {"merchantId":"<uuid>","email":"nul\u0000@example.test","password":"x"}` returns `500 internal_error` (observed in the audit test, with `DatabaseError: invalid byte sequence for encoding "UTF8": 0x00` logged at level 50). Anyone can send unauthenticated requests that produce server-error responses and error-level stack traces at will. That pollutes 5xx alerting and SLOs and hides real faults. It also tells the client a server bug exists, when the problem is malformed input that should get a 4xx.

**Why it needed a fix:** A 5xx means "our fault" and pages operators. Input validation failures must be 4xx. A security review treats unauthenticated, attacker-triggerable 500s as an error-handling weakness that enables log flooding and noisy monitoring.

**Fix:** `apps/api/src/plugins/errorHandler.ts:34-38`
```diff
+  // ERR-1: Postgres rejects a NUL byte in client text (22021, or 22P05 when converting); that is bad input, not a 500
+  if (fastifyErr.code === "22021" || fastifyErr.code === "22P05") {
+    reply.code(400).send({ error: "invalid_request", message: "request contains a character that cannot be stored" });
+    return;
+  }
+
   request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
```

**Why this is the smallest correct fix:** The error handler is the single place errors become responses, and it already branches on error codes (`FST_REQ_FILE_TOO_LARGE`). Two SQLSTATEs cover the NUL case: 22021 `character_not_in_repertoire` for UTF-8 input, and 22P05 `untranslatable_character` for conversion. Both can only come from data we were given. The response reuses the `{ error: "invalid_request" }` shape the routes already return for bad input. *Why not strip or reject NULs in a preValidation hook?* That is a new global hook over every body, query and param, which is more code and could alter data that legitimately never reaches Postgres. *Why not map all class-22 errors?* Some class-22 errors, such as 22003 numeric overflow or 22012 division by zero, can come from server-side arithmetic bugs, and those must stay 500s.

**Proof:** `ERR-1: a NUL byte in a request string is a 400, not a 500` (`apps/api/src/routes/auth.audit.test.ts`).
Before: `actual: { status: 500, error: 'internal_error' }`.
After: `{ status: 400, error: 'invalid_request' }`. The file passes 5/5, and `tsc --noEmit` is clean.

**Regression risk:** Very low. Only the two SQLSTATEs change from 500 to 400. No transaction is affected, because the failing statement already aborted it and `withTransaction` rolls back as before.

Lines: prod +6/-0, test +11/-0
