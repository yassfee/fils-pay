### DOC-1 · Saved report filters are said to be "capped at 50 by a CHECK in 0061"; no cap exists anywhere · Severity: Low (reported, not changed)

**Lead:** Team 45 heads-up list (B4c), verified by us.
**Category:** Reported, not changed

**What's wrong:** the doc comment on `listSavedFilters` (`apps/api/src/reporting/savedFilters.ts:43-46`) says "there is no pagination because a merchant is capped at 50 saved filters by a CHECK in the 0061 migration". Migration 0061 is `0061_chart_of_accounts_goodwill.sql`; the table is created in `0069_reporting_saved_filters.sql` with no CHECK and no count limit, and `POST /v1/reporting/saved-filters` (`routes/reporting.ts:52-70`) inserts without counting. Our probe stored a 100,000-character name with 201.

**Why it happens:** the cap was documented and never implemented; `GET /v1/reporting/saved-filters` returns every row unpaginated on the strength of that claim.

**What it breaks:** only the merchant's own data: each merchant can grow only its own list, the request body is capped at 1 MiB, and the list endpoint is scoped to the caller's `merchant_id`. A merchant who saves thousands of presets makes its own list response large; there is no cross-tenant effect, no 500 and no money impact.

**Why it is reported, not changed:** no trusted source (case file, ADRs, Yousif's HANDOVER lines) sets a limit, and none of the precision-bar properties (money, tenant isolation, auth, data loss, a crash) is violated, so the behaviour is arguably intended and only the comment is wrong. The fix we would make if product wants the cap: in `createSavedFilter`, insert with `INSERT … SELECT $1, $2, $3::jsonb WHERE (SELECT count(*) FROM reporting_saved_filters WHERE merchant_id = $1) < 50` and answer 409 `saved_filter_limit` when no row comes back (about 3 lines), and correct the comment to name 0069.

**Proof:** `grep -rln reporting_saved_filters db/migrations` → only 0069, which has no CHECK; probe `POST /v1/reporting/saved-filters` with a 100,000-character name → 201.

**Regression risk:** none (no change).

Lines: prod +0/-0 (proposed about +3), test +0/-0
