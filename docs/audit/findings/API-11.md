### API-11 · A non-numeric `?limit` on the merchant list routes sends `LIMIT NaN` to Postgres and answers 404 "malformed identifier" · (no case ref; plainly invalid input) · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.

**What's wrong:** `GET /v1/transactions?limit=abc`, `GET /v1/settlement/batches?limit=abc`, `GET /v1/merchants/:id/payment-links?limit=abc` and `GET /v1/merchants/:id/webhook-endpoints/:id/deliveries?limit=abc` answered `404 {"error":"not_found","message":"malformed identifier"}`: a list that exists is reported as not found, for a query parameter that is not an identifier. The admin list routes treat the same input as "use the default page" (200).

**Why it happens:** each route parses `limit` with `Number.parseInt(q.limit, 10)` (`routes/transactions.ts:128`, `routes/settlement.ts:44`, `routes/paymentLinks.ts:126`, `routes/webhooks.ts:195`), which gives `NaN` for `abc`. The list functions clamp with `Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT))` (`transactions/query.ts:101`, `settlement/query.ts:115`, `paymentLinks/query.ts:66`, `webhooks/deliveries.ts:122`); `??` does not catch `NaN` and `Math.max(1, NaN)` is `NaN`, so the SQL runs `LIMIT NaN`. Postgres rejects it with 22P02 (invalid input syntax for type bigint), which SEC-1 maps to 404 "malformed identifier" (before SEC-1 it was a 500). The admin routes guard the same parse with `Number.isFinite` (`routes/adminMerchants.ts:106`, `routes/adminCredits.ts:56`).

**What it breaks:** a client or a crafted dashboard URL with a bad page size sees "not found" for its own transactions, batches, links or deliveries, and every such request is a failed database statement.

**Why it needed a fix:** the query must never be built from `NaN`; the platform's own admin routes define the behaviour for a non-numeric limit (fall back to the default page), and a 404 for an existing collection is wrong by HTTP semantics.

**Fix:** the same clamp line in the four list functions:
```diff
-  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
+  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(filters.limit) ? filters.limit! : DEFAULT_LIMIT)); // API-11: ?limit=abc gave LIMIT NaN
```

**Why this is the smallest correct fix:** the clamp is where every caller's limit ends up, and `Number.isFinite` is the guard the admin routes already use; one line per list function, no route or response change. *Why not answer 400?* The admin lists already define a non-numeric limit as "default page", and changing four public list routes to a new 400 would be a larger contract change. *Why not stop SEC-1 mapping 22P02 to 404?* That mapping is right for malformed ids; the fault is that a limit reached SQL as `NaN`.

**Proof:** `API-11: a non-numeric ?limit on the merchant list routes falls back to the default page, not a 404` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 200, actual: 404` (`/v1/transactions?limit=abc`), and passes after for all four routes.

**Regression risk:** numeric limits (including `-5` and huge values, still clamped to 1..100) behave as before. `src/routes/transactions.test.ts`, `settlement.test.ts`, `paymentLinks.test.ts` and `webhooks.test.ts` pass.

Lines: prod +4/-4, test +20/-0
