### UI-1 · Admin credit form pre-fills the browser's date, not the Bahrain business day · G1 · Severity: Low

**Category:** Bug

**What's wrong:** the "Post a credit" form on the admin merchant page pre-fills `effectiveDate` with `todayIso()`, which reads the browser's local calendar date. For an operator whose browser is behind Bahrain (UTC, Europe, the Americas), the default is *yesterday* during the first hours of the Bahrain day (00:00-03:00 for UTC, until 07:00/08:00 for New York). For a browser ahead of Bahrain (Asia/Dubai, UTC+4), the default is *tomorrow* from 23:00 Bahrain, and the server refuses the untouched form with `400 invalid_effective_date` ("must not be after today (Asia/Bahrain)", CRED-1).

**Why it happens:** `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:19-24` built the string from `getFullYear()/getMonth()/getDate()`, which are browser-local. The note above it (am: "browser local date not bahrain, fine for bahrain staff") states the assumption. The server side validates against Bahrain's day (`apps/api/src/admin/creditRequestValidation.ts:84`, CRED-1), so the two disagree whenever the browser is not on UTC+3.

**What it breaks:** a credit posted with the default records the wrong accounting date on `credit_requests.effective_date` (the date Yousif's handover calls the credit's metadata, `docs/HANDOVER.md:60-61`), or the form fails with a validation error the operator did not cause. The same defect in the run-batch form was UI-SETTLE-1; this is the credit form's own date helper.

**Why it needed a fix:** the settlement business day runs midnight to midnight Asia/Bahrain (case file p.1: "Settlement closes every day at midnight, Bahrain time (UTC+3)"; G1), and the API already enforces that day; the form's default must be the same day for every operator.

**Fix:** `apps/admin/src/pages/merchants/MerchantDetailPage.tsx:19-24`
```diff
-function todayIso(): string {
-  const now = new Date();
-  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
-    now.getDate(),
-  ).padStart(2, "0")}`;
+export function todayIso(): string {
+  // UI-1 (G1): today's Asia/Bahrain (UTC+3, no DST) calendar day, the business day CRED-1 validates against.
+  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
 }
```
`export` is added only so the test can load the helper.

**Why this is the smallest correct fix:** the helper is the single source of the default; the new body is the same fixed-offset expression UI-SETTLE-1 and the API (`creditRequestValidation.ts`) already use, so the three agree by construction. *Why not `Intl.DateTimeFormat` with `timeZone: "Asia/Bahrain"`?* Correct too, but a second way of computing the same day in the same app. *Why not change the server?* The server is right; only the pre-filled value was wrong, and the operator can still type any valid date.

**Proof:** `UI-1: todayIso is the Bahrain calendar day, not the browser's` (`apps/admin/src/pages/merchants/MerchantDetailPage.test.ts`) sets `TZ=UTC` and mocks `Date` at 01:30 on 30 Oct in Bahrain (`2026-10-29T22:30:00Z`); before the fix it fails with `expected: '2026-10-30'`, `actual: '2026-10-29'`. After the fix it passes, and also with `TZ=Asia/Dubai` at 23:30 Bahrain (the browser's 31 Oct). `apps/admin` `npm test` 4/4, `tsc --noEmit` clean.

**Regression risk:** only the pre-filled value changes, and only when the browser is not on UTC+3; the request shape and the server's validation are unchanged.

Lines: prod +3/-5, test +27/-0
