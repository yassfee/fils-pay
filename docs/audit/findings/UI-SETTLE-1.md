### UI-SETTLE-1 · Admin "Run batch" form defaults to the wrong business date between 00:00 and 03:00 Bahrain · G1 · Severity: Medium

**Lead:** Team 45 heads-up list (Q3-02), verified by us.

**What's wrong:** On the admin console's Settlement page, the business date in the "Run batch" form defaults to the UTC date of "now minus 24 h", not to yesterday's Bahrain date. From 00:00 to 03:00 Bahrain the field shows the day before yesterday. For example, at 01:30 on 30 Oct it shows `2026-10-28`, not `2026-10-29`.

**Why it happens:** `yesterdayIso` (`apps/admin/src/pages/settlement/SettlementPage.tsx:19-23`) subtracts one day in browser-local time with `setDate(getDate() - 1)`, then reads the date with `toISOString().slice(0, 10)`, which is the UTC calendar date. Whatever the browser's timezone, the result is the UTC date 24 hours ago. That matches the Bahrain date only after 03:00 Bahrain. The comment above it ("browser-local yesterday") does not describe what the code returns.

**What it breaks:** The business date is the batch the operator is about to close. After midnight, a finance operator who accepts the default re-runs the day before yesterday. That run is idempotent and returns already-closed batches, so it looks like a success, and the day that actually needs closing stays open. Merchants are then paid a day late, which is the G1 symptom from the other side.

**Why it needed a fix:** The case file says settlement closes every day at midnight Bahrain time (UTC+3), so the default batch date must follow the Bahrain calendar. A wrong default on a money-moving form is a UX bug that operators will not notice.

**Fix:** `apps/admin/src/pages/settlement/SettlementPage.tsx:19-22`
```diff
-function yesterdayIso(): string {
-  const date = new Date();
-  date.setDate(date.getDate() - 1);
-  return date.toISOString().slice(0, 10);
+export function yesterdayIso(): string {
+  // UI-SETTLE-1 (G1): yesterday's Bahrain (UTC+3, no DST) calendar day, the business date batches close on.
+  return new Date(Date.now() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
```
`apps/admin/package.json`: added a `"test"` script (`tsx --test "src/**/*.test.ts"`, the same form as `apps/web`), so the root `npm test` (`--workspaces --if-present`) runs the new admin test. Before this, apps/admin had no test script.
Commit: this commit. Lines: prod +3/-4 (SettlementPage.tsx) plus infra +2/-1 (package.json), test +22/-0.

**Why this is the smallest correct fix:** It is one expression in the one function that sets the default, and the form still lets the operator pick any date. Bahrain has had no DST since 1972, so a fixed +3 h shift is exact. This is the same approach the merchant dashboard already uses (`apps/web/src/pages/settlement/ReconciliationPage.tsx:19-26`). *Why not `toLocaleDateString` with `timeZone: "Asia/Bahrain"`?* Its output format depends on the locale and ICU version, while `toISOString` always gives `YYYY-MM-DD`. The `export` is needed so the function can be tested. React Fast Refresh then does a full reload of this page in dev, and production is unaffected.

**Proof:** `yesterdayIso is the Bahrain calendar day before today` (`apps/admin/src/pages/settlement/SettlementPage.test.ts`) mocks `Date` at 01:30 on 30 Oct in Bahrain (`2026-10-29T22:30:00Z`). Before the fix it fails with `expected: '2026-10-29'`, `actual: '2026-10-28'`. It passes after the fix, and also with `TZ=Asia/Bahrain` and `TZ=America/New_York`. The second case, 23:59 Bahrain, pins the normal path. The test loads the page through Vite's `ssrLoadModule` because the admin API client reads `import.meta.env`, which plain `tsx` does not define. `tsc --noEmit` for apps/admin is clean.

**Regression risk:** Outside 00:00-03:00 Bahrain the default is unchanged. Only the pre-filled value changes: the request shape, `POST /v1/admin/settlement/run-batch`, and the server-side validation are all unchanged.

**Trap note:** `SettlementPage.tsx:18` ("YA: browser-local yesterday") is left as-is. It was never accurate (the old code returned a UTC date), and the new in-function comment states what the code does.

**Follow-up UI-1 (same class, merged into this row):** the merchant page's "Post a credit" form had its own date helper, `todayIso()` (`apps/admin/src/pages/merchants/MerchantDetailPage.tsx:19-24`), built from the browser's local calendar. A browser behind Bahrain pre-filled yesterday's date between 00:00 and 03:00 Bahrain (until 07:00/08:00 for New York), so a credit posted with the default recorded the wrong `effective_date`, or failed the server's Bahrain-day validation (CRED-1) for a reason the operator did not cause. Fix (`cd95697`, prod +3/-5): the helper returns the UTC+3 calendar day (`new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)`; Bahrain has no DST), and is exported for the test. Proof: `UI-1: todayIso is the Bahrain calendar day, not the browser's` (`MerchantDetailPage.test.ts`, `TZ=UTC`, mocked 2026-10-29T22:30:00Z) failed with 2026-10-29 before and passes with 2026-10-30 after; admin tests 4/4. Lines: prod +3/-5, test +27/-0.
