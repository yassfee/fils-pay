### HUNT-1 · A malformed or impossible date in a query string is a 500 instead of a 400 · Severity: Low

**What's wrong:** `GET /v1/transactions?from=garbage`, `GET /v1/transactions/export?to=2026-13-01`, `GET /v1/settlement/batches?from=garbage` and `GET /v1/analytics/volumes?from=2026-02-30` (also `payout-trends`) all answer `500 {"error":"internal_error"}` with an error-level stack trace, for any authenticated merchant user or API key.

**Why it happens:** the transactions list and export (`routes/transactions.ts:133-134,151-152`) and settlement batches (`routes/settlement.ts:48-49`) pass `new Date(q.from)` straight to `pg`; an Invalid Date is serialised as `NaN-NaN-...`, and Postgres raises SQLSTATE 22007 (`invalid input syntax for type timestamp with time zone`). Analytics' `isValidDateString` (`routes/analytics.ts:75`) checks only the `YYYY-MM-DD` shape, so `2026-02-30` reaches `volume_date >= $2` and Postgres raises 22008 (`date/time field value out of range`). `plugins/errorHandler.ts` maps 22021/22P05 (ERR-1) and 22P02 (SEC-1) to 4xx, but every other database error falls through to the 500 branch.

**What it breaks:** an API integration with a typo in a date gets "internal error" instead of being told what is wrong, and any logged-in user can produce error-level 500s and stack traces at will, polluting 5xx alerting the same way ERR-1 described.

**Why it needed a fix:** malformed client input must be a 4xx; a 500 says the server is broken and pages operators.

**Fix:** `apps/api/src/plugins/errorHandler.ts:40-44`
```diff
+  // HUNT-1: a malformed (22007) or impossible (22008, e.g. 2026-02-30) date from a query string is bad input, not a 500
+  if (fastifyErr.code === "22007" || fastifyErr.code === "22008") {
+    reply.code(400).send({ error: "invalid_date", message: "dates must be valid ISO 8601 dates or instants" });
+    return;
+  }
```
The response reuses the `invalid_date` code that `routes/analytics.ts:76` already returns for a badly shaped date.

**Why this is the smallest correct fix:** one branch at the single place errors become responses, next to the ERR-1 and SEC-1 branches that do the same for other input-only SQLSTATEs. *Why not validate in each route?* Four handlers in three files (more lines, and the next route forgets it). *Why not map all class-22 errors?* As ERR-1 noted, 22003 (numeric overflow) and 22012 (division by zero) can come from server arithmetic and must stay 500s; 22007/22008 are date-literal parsing errors, which here only come from the client's query string.

**Proof:** `HUNT-1: a malformed date query parameter is a 400, not a 500` (`apps/api/src/routes/dateInput.audit.test.ts`). Before: all four URLs `-> 500`. After: all four `-> 400`.

**Regression risk:** only requests that already failed with a 500 change. Valid dates are untouched. `routes/analytics.test.ts`, `routes/settlement.test.ts`, `routes/transactions.test.ts` and `routes/auth.audit.test.ts` pass (40/40 with the new test). `GET /v1/settlement/reconciliation` and `/summary` fail earlier, in JavaScript, and are HUNT-2.

Lines: prod +5/-0, test +56/-0
