### ERR-1 · Client-input database errors answered 500 instead of 4xx (NUL bytes, malformed ids, unknown merchants in the CSV import) · Severity: Low

**Lead:** Team 45 heads-up list (SEC5), verified by us.
**Category:** Bug

One row for one class of defect: input the client controls reaches Postgres, Postgres refuses it, and the API reports its own failure (500, error-level stack trace) instead of the client's (4xx). Three instances, each fixed at its narrowest point: NUL bytes (below), malformed path ids (follow-up SEC-1) and unknown merchants in the CSV adjustment import (follow-up IMP-4).

**What's wrong:** JSON allows `\u0000` inside strings, and Postgres `text` cannot store it. Any client string that reaches a query with a NUL byte made Postgres raise SQLSTATE 22021 ("invalid byte sequence for encoding UTF8: 0x00"), and the API answered `500 {"error":"internal_error"}` with a full stack trace in the error log. This works on any endpoint, including unauthenticated ones such as `POST /v1/auth/login`.

**Why it happens:** `apps/api/src/plugins/errorHandler.ts:16-35` maps `AppError`, Fastify validation errors and multipart limits. Every other error, including a `pg` `DatabaseError` caused purely by client input, falls through to the 500 branch (`:34-35`). No route rejects control characters, and none needs to as long as the database's own refusal is mapped correctly.

**What it breaks:** `POST /v1/auth/login {"merchantId":"<uuid>","email":"nul\u0000@example.test","password":"x"}` returns `500 internal_error` (observed in the audit test, with `DatabaseError: invalid byte sequence for encoding "UTF8": 0x00` logged at level 50). Anyone can send unauthenticated requests that produce server-error responses and error-level stack traces at will. That pollutes 5xx alerting and SLOs and hides real faults. It also tells the client a server bug exists, when the problem is malformed input that should get a 4xx.

**Why it needed a fix:** A 5xx means "our fault" and pages operators. Input validation failures must be 4xx. A security review treats unauthenticated, attacker-triggerable 500s as an error-handling weakness that enables log flooding and noisy monitoring.

**Fix:** `apps/api/src/plugins/errorHandler.ts:34-38` (`59d1770`)
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

**Follow-up SEC-1 (ours, merged into this row):** malformed path ids. Merchant routes pass the raw `:id` segment into a `uuid` comparison, so `/v1/transactions/not-a-uuid` made Postgres raise 22P02 and the API answered 500; a probe found 14 merchant routes affected (transaction detail, events, capture, void; settlement batch detail and transactions; KYC file and thumbnail; API-key revoke; payment-link cancel; webhook-endpoint delete, patch, test and deliveries). The admin routes already guard ids with `assertUuidParam` → 404 (`routes/adminBalanceAdjustments.ts:14-18`), `admin.test.ts:788` pins "404s for an unknown or malformed id", and the transactions cross-tenant test names the contract "returns 404, not 403 or 500". Lead: our own sweep of `apps/api/src/routes/*.ts`. Fix (`a996cd2`, `errorHandler.ts:46-50`): 22P02 → `404 {"error":"not_found"}`, so a malformed id behaves exactly like an unknown one and leaks nothing; ids the server generates are always valid UUIDs, so 22P02 here can only come from the client. Rejected: an `assertUuidParam` call in each of 14 handlers across 6 files (about 30 lines); 400 (the existing contract on the admin plane is 404). Proof: `SEC-1: a malformed id on merchant :id routes is a 404, not a 500` (`apps/api/src/routes/transactions.audit.test.ts`) covers four routes in four route files; before, all four returned 500, after, 404. Lines: prod +6/-0, test +23/-0.

**Follow-up IMP-4 (ours, merged into this row):** unknown merchants in the CSV adjustment import (case file F7 is about this import). `POST /v1/admin/adjustment-imports` checks only that each merchant id is UUID-shaped (`routes/adminAdjustmentImport.ts:62-66`); for a well-formed but unknown id, `applyAdjustmentImport` (`admin/adjustmentImport.ts`) hit the `ledger_entries`/`merchant_balances` foreign key inside its loop and the import answered 500 with no row number. The transaction rolled back, so no money moved, but finance could not tell which of 40 rows to fix. Lead: Team 45 heads-up list (Q3-03), verified by us. Fix (`b3cad51`, `adjustmentImport.ts:56-58`): one set query before anything is written, `SELECT 1 FROM merchants WHERE id = ANY($1::uuid[])`, and a 404 `merchant_not_found` (the code the credit and balance routes use) if any id is unknown. Rejected: catching and mapping the FK error (depends on the constraint name and still fails mid-transaction). The same commit also added a 3-line NUL row check to the CSV parser (`adjustmentCsvParsing.ts:42-44`, 400 `invalid_csv_row` naming the row). That half is not a separate bug: ERR-1 (`59d1770`, committed before it) already answers a NUL byte with 400 everywhere, including this import. The check stays only because its message names the row; its lines are counted below. Reported, not changed (each needs a product decision): rejecting zero-amount rows (documented as allowed, `adjustmentImport.ts:111`), requiring a reason (`adjustmentCsvParsing.test.ts` pins it optional), and capping rows at the maker-checker threshold (would refuse the `120.00` BD example in `docs/ADMIN.md:66-67`). Proof: `IMP-4: an unknown merchant id is a 404 and a NUL in a reason is a 400; nothing is applied` (`apps/api/src/routes/adminAdjustmentImport.test.ts`); before the fix `expected: 404, actual: 500`, after it 404 `merchant_not_found` and no ledger leg. Lines: prod +7/-1 (unknown merchant: `adjustmentImport.ts` +4/-1; parser NUL row check +3/-0), test +15/-0.

Lines: prod +19/-1 (ERR-1 +6/-0 `59d1770`; SEC-1 +6/-0 `a996cd2`; IMP-4 +7/-1 `b3cad51`), test +49/-0 (+11, +23, +15)
