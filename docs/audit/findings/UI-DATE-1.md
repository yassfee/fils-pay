### UI-DATE-1 · Merchant dashboard date filters use the UTC day, so each day loses its first 3 Bahrain hours · G1 · Severity: Medium

**Lead:** Team 45 heads-up list (N13), verified by us.

**What's wrong:** On the merchant dashboard's Transactions page, the `From` and `To` date pickers filter on the UTC day instead of the Bahrain business day. Picking `From = 2026-09-12` sends `from=2026-09-12T00:00:00.000Z`, which is 03:00 in Bahrain. Transactions made between 00:00 and 03:00 Bahrain on the chosen day are missing, and the `To` day picks up the first 3 hours of the next Bahrain day.

**Why it happens:** `dayStartIso` (`apps/web/src/format.ts:35-37`) turns the `<input type="date">` value into `${dateValue}T00:00:00.000Z`, which is a UTC midnight. `TransactionListPage.tsx:55-56` passes the result as `from`/`to`, and `GET /v1/transactions` (`apps/api/src/routes/transactions.ts:133-134`) compares it directly with `occurred_at` (`>= from`, `< to`). The case file says the business day runs from midnight to midnight Bahrain time (UTC+3). The comment at `format.ts:34` ("fixed, uses bahrain time now — am") is false: the code was never changed.

**What it breaks:** A merchant who filters on one day (`From = D`, `To = D+1`) gets a window from 03:00 on D to 03:00 on D+1. That window misses that day's late-night sales and includes 3 hours of the next day. The totals no longer match the settlement batch for the same business date, which closes at Bahrain midnight (G1). Support then gets "my dashboard and my payout disagree" tickets.

**Why it needed a fix:** The case file says settlement closes every day at midnight Bahrain time (UTC+3). A dashboard filter that uses a different day boundary from settlement shows the merchant the wrong set of transactions for the day they picked.

**Fix:** `apps/web/src/format.ts:36` (the docstring at `:28` is corrected to match)
```diff
-  return dateValue ? `${dateValue}T00:00:00.000Z` : undefined;
+  return dateValue ? `${dateValue}T00:00:00.000+03:00` : undefined;
```
Commit: this commit. Lines: prod +2/-2 (1 code, 1 docstring), test +5/-2.

**Why this is the smallest correct fix:** `dayStartIso` is the only place the dashboard turns a date into an instant, and both filters call it. Bahrain has had no DST since 1972, so a fixed `+03:00` offset is exact, and the API already parses offset ISO strings (`new Date(q.from)`). `buildQuery` uses `URLSearchParams`, so the `+` is sent as `%2B` and is not read as a space (the test checks this). *Why not convert the date on the server?* The endpoint's contract is "ISO-8601 instants" (`routes/transactions.ts:28`), and API-key clients depend on it. *Why not `Intl` with `timeZone: "Asia/Bahrain"`?* It needs more code to get the same fixed offset. `ReconciliationPage.tsx:19` already uses the fixed `+3h` approach.

**Proof:** `dayStartIso converts a date input to the Asia/Bahrain day boundary` (`apps/web/src/dashboard.test.ts`) fails before the fix with `expected: '2026-09-11T21:00:00.000Z'`, `actual: '2026-09-12T00:00:00.000Z'`. It passes after the fix. The old assertion (`=== "2026-09-12T00:00:00.000Z"`) encoded the bug and has been corrected, citing the case file. `apps/web` tests: 8/8 pass, and `tsc --noEmit` is clean.

**Regression risk:** The query value is still a valid ISO-8601 instant. Only its offset changes, so the API contract is unchanged. With no date picked, no `from`/`to` param is sent, as before.

**Trap note:** `format.ts:34` ("fixed, uses bahrain time now — am") claimed a fix that did not exist. `format.ts:33` ("YA: UTC day boundary, NOT Bahrain … known") and `TransactionListPage.tsx:28` ("from/to are UTC day starts") describe the old behaviour. They are left as-is (initials notes are claims, not code).
