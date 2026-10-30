### HUNT-2 · Settlement reconciliation and summary: a malformed date is a 500, an impossible date silently shifts the window · FP-300 · Severity: Low

**What's wrong:** `GET /v1/settlement/reconciliation` and `GET /v1/settlement/summary` (the FP-300 reports) answer `500 internal_error` for `from=garbage` or `to=2026-10-1`, and accept `to=2026-02-31` as **3 March**: the report then silently covers a different window from the one the user asked for.

**Why it happens:** both handlers (`routes/settlement.ts:58-90`) only check that `from`/`to` are present and pass the strings to `bahrainLocalMidnightUtc` (`apps/api/src/settlement/query.ts:267-273`). It builds `new Date("<s>T00:00:00+03:00")` and throws a plain `RangeError` for an Invalid Date, which the error handler turns into a 500. For a well-shaped but impossible date, V8 rolls the day over (`2026-02-30` becomes 2 March, `2026-02-31` 3 March), so no error is raised at all.

**What it breaks:** API users and the dashboard's date fields (typed values) get "internal error" instead of a validation message, and any user can produce error-level 500s. With a rolled-over date, a February reconciliation (`from=2026-02-01&to=2026-02-31`) quietly includes 1-2 March, so its gap and totals disagree with the February batches.

**Why it needed a fix:** these are the reports finance relies on to tie the ledger to settlement (FP-300); a wrong window must be refused, and bad input must be a 4xx.

**Fix:** `apps/api/src/settlement/query.ts:2,270-271`
```diff
 import type { Pool } from "pg";
+import { BadRequestError } from "../lib/errors.js";
@@
   const parsed = new Date(`${dateStr}T00:00:00+03:00`);
-  if (Number.isNaN(parsed.getTime())) {
-    throw new RangeError(`bahrainLocalMidnightUtc: invalid date "${dateStr}"`);
+  if (Number.isNaN(parsed.getTime()) || new Date(parsed.getTime() + 3 * 3600_000).toISOString().slice(0, 10) !== dateStr) {
+    throw new BadRequestError("invalid_date", `"${dateStr}" is not a valid YYYY-MM-DD date`); // HUNT-2: was a RangeError (500); 2026-02-30 rolled to 2 March
```
The date is accepted only if the Bahrain calendar date of the computed midnight is exactly the string given, which rejects both malformed and rolled-over dates; the error is the `invalid_date` 400 used elsewhere.

**Why this is the smallest correct fix:** the helper is the single place both reports turn the strings into instants, and it already had the validity check; only its condition and error class change. *Why not validate in the route?* Two handlers instead of one helper. *Why not map `RangeError` to 400 in the error handler?* `toFils` and the money helpers throw `RangeError` for server-side arithmetic faults, which must stay 500s.

**Proof:** `HUNT-2: settlement reconciliation and summary reject malformed and impossible dates with 400` (`apps/api/src/routes/dateInput.audit.test.ts`). Before: `from=garbage -> 500`, `to=2026-10-1 -> 500`, `to=2026-02-31 -> 200`. After: all `-> 400`.

**Regression risk:** valid `YYYY-MM-DD` dates (what the dashboard's `<input type="date">` and default range send, `apps/web/src/pages/settlement/ReconciliationPage.tsx:22-26,93-97`) compute the same instants as before. `routes/settlement.test.ts`, `routes/settlement.refunds.audit.test.ts` and `settlement/*.test.ts` pass (17/17 with the new tests).

**Follow-up K-4 (same class, merged into this row):** the analytics validator had the same rollover. `GET /v1/analytics/top-links?from=2026-02-30&to=2026-03-05` answered 200 with the links paid from 2 March, although the validator's own comment says it rejects 2026-02-30 and the other three analytics endpoints answer 400 for it. Fix (`af26154`, `apps/api/src/routes/analytics.ts:25`, prod +1/-1): the date must also round-trip (`new Date(value).toISOString().slice(0, 10) === value`). Proof: `K-4: top-links rejects an impossible calendar date (2026-02-30) with 400` (`routes/analytics.test.ts`): 200 before, 400 `invalid_date` after; analytics tests 15/15.

Lines: prod +4/-3 (HUNT-2 +3/-2; K-4 +1/-1), test +19/-0 (+12; +7)
