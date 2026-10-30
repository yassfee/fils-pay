### SEC-1 · Every merchant `:id` route answers 500 for a malformed id (Postgres 22P02) instead of 404 ·  · Severity: Low

**Lead:** own sweep of `apps/api/src/routes/*.ts` (wave 3 lane A).

**What's wrong:** Merchant routes pass the raw `:id` path segment straight into a `uuid` column comparison. Any non-UUID id (`/v1/transactions/not-a-uuid`) makes Postgres raise SQLSTATE 22P02 (`invalid input syntax for type uuid`), and the API answers `500 {"error":"internal_error"}` with an error-level stack trace. A probe found 14 merchant routes affected: transaction detail, events, capture and void; settlement batch detail and transactions; KYC file and thumbnail; API-key revoke; payment-link cancel; webhook-endpoint delete, patch, test and deliveries.

**Why it happens:** The admin routes guard every id with `assertUuidParam` → `NotFoundError` (for example `routes/adminBalanceAdjustments.ts:14-18` and `routes/adminMerchants.ts`), and `admin.test.ts:788` pins "404s for an unknown or malformed id". The merchant routes never got that guard, and `plugins/errorHandler.ts:16-35` sends any unmapped `DatabaseError` to the 500 branch.

**What it breaks:** `GET /v1/transactions/not-a-uuid` with a valid session or API key returns 500, and the same happens on all 14 routes. Any authenticated merchant (or a client with a buggy id) can generate unlimited server errors and error-level stack traces, polluting 5xx alerting and hiding real faults. The API contract also becomes inconsistent: an unknown UUID gets 404, a malformed one gets 500, and the existing tests describe the intended contract as "returns 404, not 403 or 500" (`routes/transactions.test.ts`, cross-tenant test).

**Why it needed a fix:** 5xx responses that clients can trigger at will are an error-handling weakness a security review flags: log flooding, noisy SLOs, and a "server bug" signal on bad input. The platform's own convention is 404 for malformed ids.

**Fix:** `apps/api/src/plugins/errorHandler.ts:40-44`
```diff
+  // SEC-1: a malformed id (e.g. /v1/transactions/not-a-uuid) makes Postgres raise 22P02; like admin routes, that is a 404
+  if (fastifyErr.code === "22P02") {
+    reply.code(404).send({ error: "not_found", message: "malformed identifier" });
+    return;
+  }
+
   request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
```

**Why this is the smallest correct fix:** One mapping in the single place errors become responses, rather than an `assertUuidParam` call added to each of 14 handlers across 6 files (about 30 lines, with a new shared helper or 6 copies). It returns 404, which matches the admin routes, `admin.test.ts:788` and the "404, not 500" contract named in the transactions test, so a malformed id behaves exactly like an unknown one. That also means it leaks nothing about which ids exist. 22P02 means "this text is not a valid value of the target type". In this API it comes from client-supplied ids, because ids generated server-side are always valid UUIDs. *Why not 400?* The existing contract for a malformed path id is 404 on the admin plane, so we keep one behaviour across planes. *Why not add per-route guards?* That is far more lines for the same result, and any future route would still need remembering.

**Proof:** `SEC-1: a malformed id on merchant :id routes is a 404, not a 500` (`apps/api/src/routes/transactions.audit.test.ts`) covers four routes in four route files.
Before: `actual: ['/v1/transactions/not-a-uuid -> 500', '/v1/settlement/batches/not-a-uuid -> 500', '/v1/merchants/:m/kyc/documents/not-a-uuid/file -> 500', '/v1/merchants/:m/webhook-endpoints/not-a-uuid/deliveries -> 500']`.
After: all four return `404`. The transactions audit, transactions, settlement and webhooks suites pass 35/35.

**Regression risk:** Low. Only SQLSTATE 22P02 changes, from 500 to 404, and nothing changes for valid ids. A hypothetical server-side bug that casts bad text would now surface as a 404 rather than a 500. We accept that, because every id the server generates is a database-issued UUID.

Lines: prod +6/-0, test +23/-0
