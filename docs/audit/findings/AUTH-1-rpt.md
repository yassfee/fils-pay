### AUTH-1·rpt · Reporting export-summary has no authentication gate · H3 · Severity: Low
**What's wrong:** `GET /v1/reporting/export-summary` (`apps/api/src/routes/reporting.ts:79`) is the only reporting route registered without `requireMerchantAuth`.

**Why it happens:** the handler reads `request.merchantAuth!.merchantId`. The `!` tells TypeScript the value exists, but no preHandler ever sets it for this route. The file's own header says every route uses `requireMerchantAuth` (`:18`).

**What it breaks:** an anonymous request throws a TypeError and gets a 500 (an availability and noise problem). If any future hook populated `merchantAuth` loosely, it would become a data exposure. No data leaks today.

**Why it needed a fix:** every merchant-data route must refuse anonymous callers with 401, not crash.

**Fix:** `reporting.ts:79` `app.get("/export-summary", { preHandler: requireMerchantAuth }, async (request) => {`. Lines: prod +1/−1, test +28/−0.

**Why this is the smallest correct fix:** the same one-line gate its sibling routes use.

**Proof:** `routes/reporting.audit.test.ts` "export-summary requires a merchant session (401, not a 500 crash)": before `actual: 500`, after 401.

**Regression risk:** none; authenticated callers see the same response.

**Trap note:** the non-null assertion `merchantAuth!` silenced the type checker that would otherwise have flagged the missing gate.
