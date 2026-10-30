### ERR-1 · Client input answered 500 instead of 4xx (NUL bytes, malformed ids, dates and bodies, invalid fields, out-of-range numbers, corrupt images, unknown merchants in the CSV import) · Severity: Low

**Lead:** Team 45 heads-up list (SEC5), verified by us.
**Category:** Bug

One row for one class of defect: input the client controls reaches Postgres, Postgres refuses it, and the API reports its own failure (500, error-level stack trace) instead of the client's (4xx). Each instance is fixed at its narrowest point: NUL bytes (below), malformed path ids (follow-up SEC-1), unknown merchants in the CSV adjustment import (follow-up IMP-4), malformed dates and invalid signup fields (HUNT-1, HUNT-4), and ten more from the wave-3 sweep (table at the end).

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

**Follow-up HUNT-1 and HUNT-4 (same class, merged into this row):** a malformed or impossible date in a query string (pg 22007/22008) and an unknown `businessType` or a country longer than two letters at public signup (pg 23514/22001) were also 500s; both now answer 400. Fixes: `errorHandler.ts:40-45` (`acd3311`) and `routes/businessProfile.ts:40-42` (`d3d7137`). Proof: `HUNT-1: a malformed date query parameter is a 400, not a 500` (`routes/dateInput.audit.test.ts`; before all four URLs → 500, after → 400) and `HUNT-4: public signup rejects an unknown businessType or a country longer than two letters with 400` (`routes/auth.audit.test.ts`; before 500, after 400).

**Follow-up sweep (wave 3, same class, merged into this row):** a probe of every merchant, admin and public route with plainly invalid input. Each case answered 500 (or, for API-11, a misleading 404) before the fix and a 4xx after; every proof test is in `apps/api/src/routes/badInput.audit.test.ts` and failed first.

| ID | input | fix | commit | prod |
|---|---|---|---|---|
| API-1 | malformed, empty, oversized or non-JSON body, any route (login included) | `plugins/errorHandler.ts`: pass Fastify's own 400/413/415 through | `574d668` | +6/-0 |
| API-2 | admin merchant search with a repeated `q` | `routes/adminMerchants.ts`: 400 when `q` is not a string | `042c740` | +1/-0 |
| API-3 | transactions report with `filter=null` | `routes/reporting.ts:31`: null means no filter | `c098ff0` | +1/-1 |
| API-4 | balance adjustment with a delta past 2^53 fils (ADR-0001) | `routes/adminBalanceAdjustments.ts:29`: `Number.isSafeInteger` | `d392e30` | +1/-1 |
| API-7 | payment link for 0 fils (DB CHECK) | `paymentLinks/create.ts`: 400 `invalid_amount` | `4574d80` | +1/-0 |
| API-8 | webhook endpoint PATCH with an unknown `status` | `webhooks/update.ts`: 400 | `9fbdedd` | +3/-0 |
| API-9 | KYC PNG/JPEG with a valid signature but corrupt data | `onboarding/kycThumbnail.ts:39`: 422 `invalid_file_type` | `c11e2f5` | +1/-1 |
| API-11 | `?limit=abc` on 4 merchant list routes (`LIMIT NaN` → 404) | the clamp line in each list query: default page | `d9c31de` | +4/-4 |
| API-12 | public signup with a non-string password (argon2 throws) | `routes/businessProfile.ts`: 400 | `566671d` | +3/-0 |
| HUNT-6 | business-profile PATCH with unknown or inherited keys, bad `businessType`/country, null required fields | `onboarding/businessProfile.ts`: 400 before the SQL is built | `f09c04c` | +6/-1 |

API-2's other half (`%` and `_` in `q` act as LIKE wildcards) is reported, not changed: it widens a search an admin already may run. Proof: API suite 480/480 on the lane database after API-12, `tsc --noEmit` clean.

Lines: prod +55/-9 across 15 sites, 1-7 lines each (wave-3 sweep +27/-8; ERR-1 +6/-0 `59d1770`; SEC-1 +6/-0 `a996cd2`; IMP-4 +7/-1 `b3cad51`; HUNT-1 +6/-0 `acd3311`; HUNT-4 +3/-0 `d3d7137`), test +353/-0 (+11, +23, +15, +56, +17, sweep +231)
