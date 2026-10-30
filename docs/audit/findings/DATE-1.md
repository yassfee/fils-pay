### DATE-1 · Report date windows include the exclusive "to" day, and bare report dates are UTC, not Bahrain days · Case file (Bahrain-midnight business day) · Severity: Low
**Category:** Bug

**What's wrong:** `GET /v1/analytics/recent-ledger-activity` returns ledger legs from the whole `to` day although every analytics window treats `to` as exclusive. The merchant transactions report (`GET /v1/reporting/transactions`) binds a bare `from`/`to` date straight into `occurred_at >= $n`, which Postgres reads as UTC midnight, so a "September" report drops 00:00-03:00 Bahrain on 1 September and adds 00:00-03:00 on 1 October.

**Why it happens:** `apps/api/src/analytics/query.ts:312` (before) filtered `(occurred_at AT TIME ZONE 'Asia/Bahrain')::date BETWEEN $2::date AND $3::date`; `BETWEEN` is inclusive at both ends, while `parseDateRange` documents `to` as exclusive (`routes/analytics.ts:63`) and volumes, payout trends and top links use `< $3`. `apps/api/src/reporting/transactionsReportQuery.ts:48,52` pushed the client strings unchanged; a date-only literal cast to `timestamptz` uses the session time zone (UTC in the stack), not Asia/Bahrain.

**What it breaks:** `from=2026-01-01&to=2026-01-31` returns the 31 January legs (a 777 fils leg at 09:00Z on 31 Jan in the test), so the widget double-counts a day at every month boundary when a client pages month by month. A report `from 2026-09-01 to 2026-10-01` misses a 1,000 fils capture at 01:30 Bahrain on 1 September and includes a 2,000 fils one at 01:30 on 1 October, disagreeing with the Bahrain-day settlement batches.

**Why it needed a fix:** The case file sets the day boundary: "Settlement closes every day at midnight, Bahrain time (UTC+3)" (`handoff/01_CASE_FILE_TRANSCRIPT.md:43`, "Where to start"). The settlement batches therefore cover Bahrain midnight-to-midnight days, and a report that cuts at UTC midnight, or that includes its exclusive end day, shows different days from the batches it is read against.

**Fix:** `apps/api/src/analytics/query.ts:312` and `apps/api/src/reporting/transactionsReportQuery.ts:48,52`
```diff
-        AND (occurred_at AT TIME ZONE 'Asia/Bahrain')::date BETWEEN $2::date AND $3::date
+        AND occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Bahrain') AND occurred_at < ($3::date::timestamp AT TIME ZONE 'Asia/Bahrain') -- DATE-1: "to" is exclusive
```
```diff
-    params.push(filter.from);
+    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.from) ? `${filter.from}T00:00:00+03:00` : filter.from); // DATE-1: a bare date is a Bahrain business day
 ...
-    params.push(filter.to);
+    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? `${filter.to}T00:00:00+03:00` : filter.to);
```
The ledger window is now `[Bahrain midnight of from, Bahrain midnight of to)` on the raw column, which also lets `idx_ledger_entries_merchant_occurred` serve it instead of casting every row. In the transactions report only a bare `YYYY-MM-DD` bound is anchored to Bahrain midnight; a full timestamp (what the existing test and API clients send) passes through unchanged.

**Why this is the smallest correct fix:** one predicate and two parameter bindings. *Why not change `parseDateRange` to make `to` inclusive?* Three other endpoints and the web client already use it as exclusive. *Why not reject timestamps in the report filter?* The existing contract (`transactionsReportQuery.test.ts` "from/to narrow the reported range, upper bound exclusive") sends full ISO timestamps.

**Proof:** `DATE-1: recent-ledger-activity excludes the \`to\` day and uses Bahrain-midnight bounds` (`apps/api/src/routes/analytics.test.ts`) fails before with `actual` containing `777, 777`; `DATE-1: bare from/to dates are Asia/Bahrain midnights; full timestamps are unchanged` (`apps/api/src/reporting/transactionsReportQuery.test.ts`) fails before with the 1 October transaction instead of the 1 September one. Both pass after; analytics and report tests pass (20/20).

**Regression risk:** A client that relied on the inclusive `to` of recent-ledger-activity now gets one day less, matching the documented contract. The dashboard's default window (`to` = tomorrow) still includes today.

**Trap note:** `analytics/query.ts:300-302` ("this reduces to a `date` comparison per row") presented the per-row cast as harmless; the test comment at `analytics.test.ts:379` ("checks inclusive `to` (BETWEEN). API.md says exclusive — one of them is wrong — am") had spotted it.

Lines: prod +3/-3, test +22/-0
