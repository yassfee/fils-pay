### API-2 · Admin merchant search with a repeated `q` crashes with a 500 · Severity: Low

**Lead:** Team 45 heads-up list (SEC10), verified by us.
**Category:** Bug

**What's wrong:** `GET /v1/admin/merchants?q=a&q=b` (any admin role) answered `500 internal_error` with `TypeError: filters.q.trim is not a function` in the log.

**Why it happens:** Fastify's query-string parser turns a repeated key into an array. The route (`apps/api/src/routes/adminMerchants.ts:93-108`) passes `q.q` through unchecked, although its own `ListQuery` type says `q?: string` (the sibling `onboardingStatus` is the one key it treats as possibly repeated). `listMerchantsForAdmin` (`apps/api/src/admin/merchants.ts:109`) then calls `filters.q.trim()` on the array.

**What it breaks:** the admin console's support search answers a malformed URL with a server error and an error-level log line, which any signed-in admin (or a crafted link) can trigger at will.

**Why it needed a fix:** malformed client input is a 4xx, the same rule ERR-1, SEC-1 and IMP-4 applied elsewhere.

**Fix:** `apps/api/src/routes/adminMerchants.ts`, in the list handler:
```diff
+      if (Array.isArray(q.q)) throw new BadRequestError("invalid_request", "q must be given once"); // API-2: ?q=a&q=b crashed .trim()
```

**Why this is the smallest correct fix:** one guard where the query is read, using the error class the file already imports. *Why not take the first value?* The client's intent is ambiguous, and silently dropping a search term returns a list the operator did not ask for. *Why not a Fastify querystring schema?* It would change validation and error shapes for every key on this route, not just the one that crashes.

**Proof:** `API-2: admin merchant search with a repeated q is a 400, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500`, and passes after; a single `q=a` still answers 200.

**Regression risk:** only the repeated-`q` request changes (500 to 400).

**Also seen, not changed:** `%` and `_` in `q` act as `ILIKE` wildcards (`admin/merchants.ts:124`), so `q=%` lists every merchant. Any admin can already list every merchant with no `q`, the merchant-scoped transaction search (`transactions/query.ts:111`) has the same pattern on the merchant's own rows, and nothing in the case file defines search semantics, so we report it rather than change it. The fix would be `strpos(lower(m.display_name), lower($1)) > 0` in place of the `ILIKE` arm (one line).

Lines: prod +1/-0, test +26/-0
