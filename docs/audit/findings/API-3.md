### API-3 · Transactions report with `filter=null` crashes with a 500 · (no case ref; plainly invalid input must be a 4xx) · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.

**What's wrong:** `GET /v1/reporting/transactions?filter=null` (any merchant session or API key) answered `500 internal_error` with `TypeError: Cannot read properties of null (reading 'merchantId')`. Every other JSON value the route does not use (`1`, `[]`, `"x"`) is treated as "no filter" and answers 200.

**Why it happens:** `apps/api/src/routes/reporting.ts:31` assigns `JSON.parse(request.query.filter)` to `parsed`, and `null` is valid JSON. Line 40 then reads `parsed.merchantId`, which throws on `null` only; the `try/catch` covers the parse, not the property read.

**What it breaks:** a client that serialises an absent filter as JSON `null` (a common default) gets a server error instead of its report, and anyone with a session can produce error-level 500s on demand.

**Why it needed a fix:** valid but empty input must not crash the route; the same route already answers 400 `invalid_filter` for bad JSON, so a 500 here is plainly unintended.

**Fix:** `apps/api/src/routes/reporting.ts:31`
```diff
-          parsed = JSON.parse(request.query.filter);
+          parsed = JSON.parse(request.query.filter) ?? {}; // API-3: "null" parses to null, then parsed.merchantId threw
```

**Why this is the smallest correct fix:** one operator at the single place the filter is parsed makes `null` behave like every other non-object JSON value already does (no filter), so no other status code changes. *Why not reject non-objects with 400?* That would also turn today's 200 for `1`, `[]` and `"x"` into 400, a behaviour change the bug does not require.

**Proof:** `API-3: a JSON null report filter is treated as no filter, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 200, actual: 500`, and passes after, with a body identical to the unfiltered report.

**Regression risk:** none beyond `filter=null`; RPT-SCOPE-1's scope check still runs on every request (`src/routes/reporting.audit.test.ts` passes).

Lines: prod +1/-1, test +23/-0
