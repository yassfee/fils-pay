### EXP-1 · CSV export buffers a merchant's whole history in memory in a 512 MB container · H9 · Severity: High

**What's wrong:** `GET /v1/transactions/export` calls `buildTransactionsExportCsv`, which runs an unbounded `SELECT *` (from/to optional, so no params = full history), keeps every row, maps them to a second array, joins one string and sends it.

**Why it happens:** `apps/api/src/transactions/exportCsv.ts:31-49`: `pool.query` resolves only after the driver buffered every row; `result.rows`, the lines array, the joined string and Fastify's Buffer copy are alive at once. The 3-month limit exists only in the dashboard date picker. The only paging code, `streamTransactionsExportCsv` (`:52-85`), has no caller, and its `occurred_at > $5` cursor (JS Date, ms vs µs, no tiebreak) duplicates rows and can loop forever.

**What it breaks:** FP-209 measured ~20 MB per 18,432 rows (~1.1 KB/row) over 171 MB idle RSS. A no-date export of ~310k transactions (~340 MB), or four concurrent full-history exports for Delta Wholesale (~92k rows each), exceed 512 MB; the kernel kills the API (authorize/capture, payment links, dispatcher for every merchant) and compose has no restart policy.

**Why it needed a fix:** any merchant session or API key can take the whole platform down with one request.

**Fix (bounded, not streaming):** `apps/api/src/transactions/exportCsv.ts`: `EXPORT_MAX_ROWS = 50_000`; the query gets `LIMIT $5` = 50,001 and more than 50,000 rows throws `BadRequestError("export_too_large", "narrow the date range")` (400). Worst case per request ≈ 55 MB; even five concurrent ≈ 275 MB + 171 MB idle < 512 MB. Commit: this commit. Lines: prod +8/-2, test +13/-0.

**Why this is the smallest correct fix:** it hard-bounds memory at the single query that buffers, inside the lane's file, without touching the route contract for normal exports. Rejected/deferred: real streaming (the dossier's `exportCsvChunks` generator with an `(occurred_at, id)` keyset and `Readable.from` in `routes/transactions.ts:161-171`) is the proper fix, about 20-25 lines across `exportCsv.ts` and `routes/transactions.ts` (not owned by this lane), and must replace the broken `streamTransactionsExportCsv` cursor. Why not a date-range cap: rows per range vary by merchant, so it does not bound memory. Why not silently truncate at N rows: produces a wrong file.

**Proof:** `transactions/exportCsv.test.ts` "buildTransactionsExportCsv refuses a range above the 50,000-row bound instead of buffering it" (50,001 rows): before `Missing expected rejection` (the whole history was buffered); after passes. Existing export and route tests 16/16; `tsc --noEmit` clean.

**Regression risk:** merchants with more than 50,000 transactions in the requested range now get a 400 and must narrow the range, until streaming lands. Covered by `exportCsv.test.ts`, `routes/transactions.test.ts`.

**Trap note:** the dead `streamTransactionsExportCsv` ("Cursor-paginated export for large date ranges") looks like the protection but is unused and broken; left untouched here, to be replaced by the streaming follow-up.
