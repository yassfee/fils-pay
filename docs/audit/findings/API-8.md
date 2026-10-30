### API-8 · Updating a webhook endpoint with an unknown `status` crashes with a 500 · Severity: Low

**Lead:** Team 45 heads-up list (P5/RT-500), verified by us.
**Category:** Bug

**What's wrong:** `PATCH /v1/merchants/:merchantId/webhook-endpoints/:id` with `{"status":"bogus"}`, `{"status":5}` or `{"status":"ACTIVE"}` (owner or finance) answered `500 internal_error`; the log shows a 23514 check-constraint violation on `webhook_endpoints`.

**Why it happens:** `updateWebhookEndpoint` (`apps/api/src/webhooks/update.ts:27-45`) validates `url` with `validateWebhookUrl` but passes `status` straight into `SET status = COALESCE($4, status)`. Its TypeScript type says `"active" | "disabled"`, but nothing checks the JSON body at runtime, so any value reaches the table, whose CHECK allows only `('active', 'disabled')` (`db/migrations/0021_webhook_endpoints.sql:13`).

**What it breaks:** a merchant integration or dashboard request with a typo in the status gets "internal error" instead of a validation message, and each attempt logs an error-level 500. CW-12 made "disabled" the way to stop deliveries, so this is the control merchants are told to use.

**Why it needed a fix:** malformed client input must be a 4xx; the `url` field of the same request is already validated with a 400.

**Fix:** `apps/api/src/webhooks/update.ts`, after the `url` check:
```diff
+  if (input.status !== undefined && input.status !== "active" && input.status !== "disabled") {
+    throw new BadRequestError("invalid_request", "status must be active or disabled"); // API-8: else the 0021 CHECK made it a 500
+  }
```

**Why this is the smallest correct fix:** one guard in the function that already validates the other field, mirroring the table's CHECK and using the error class the file already imports. *Why not map 23514 to 400 globally?* A CHECK violation can be a real server bug (REF-4), which must stay a 500.

**Proof:** `API-8: a webhook endpoint PATCH with an unknown status is a 400, not a 500` (`apps/api/src/routes/badInput.audit.test.ts`) fails before the fix with `expected: 400, actual: 500` (`"bogus"`), and passes after; `{"status":"disabled"}` still answers 200 and disables the endpoint.

**Regression risk:** only invalid statuses change (500 to 400). `src/routes/webhooks.test.ts` passes.

Lines: prod +3/-0, test +19/-0
