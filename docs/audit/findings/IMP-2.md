# IMP-2 · CSV adjustment import is not idempotent: the same file posts twice

Severity: High · Case ref: F7 (adjustment import), 2026-09-04 double upload

## What's wrong
Every `POST /v1/admin/adjustment-imports` inserts a fresh `adjustment_imports` row and posts every CSV row to the ledger again. Nothing identifies an import by its content, so a double-click or client retry doubles real money.

## Why it happens
- `apps/api/src/admin/adjustmentImport.ts:55-58` (before) `INSERT INTO adjustment_imports (...) VALUES ($1, $2, $3) RETURNING id`: no key; `db/migrations/0065_adjustment_imports.sql` has no UNIQUE constraint.
- Hiding cover: `adjustmentImport.ts:64` "re-upload is blocked by the unique original_filename i think — am" (no such constraint exists, and pasted CSVs all default to `pasted.csv`); `routes/adminAdjustmentImport.ts:57` "MK: finance checks the spreadsheet before uploading. fine for now".

## What it breaks
Audit export: `aug-adjustments-v3-FINAL.csv`, 31 rows, totalPostedFils 428,677, applied at 11:18:40 and again at 11:19:02 on 2026-09-04, so 857,354 fils were posted for 428,677 fils of corrections. In the test: one 4.750 BD row uploaded twice posts 9,500 fils instead of 4,750 fils.

## Why it needed a fix
It already happened in production; ledger postings and the payable cache are both doubled and nothing detects it.

## Fix
`db/migrations/0083_adjustment_imports_content_hash.sql` (new): `ADD COLUMN content_sha256 TEXT` + `CREATE UNIQUE INDEX ... (content_sha256)`.
`apps/api/src/admin/adjustmentImport.ts`:
```diff
+import { createHash } from "node:crypto";
-import { BadRequestError } from "../lib/errors.js";
+import { BadRequestError, ConflictError } from "../lib/errors.js";
-      `INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count)
-       VALUES ($1, $2, $3) RETURNING id`,
-      [input.adminUserId, input.originalFilename, input.rows.length],
+      `INSERT INTO adjustment_imports (uploaded_by_admin_user_id, original_filename, row_count, content_sha256)
+       VALUES ($1, $2, $3, $4) ON CONFLICT (content_sha256) DO NOTHING RETURNING id`,
+      [input.adminUserId, input.originalFilename, input.rows.length, createHash("sha256").update(JSON.stringify(input.rows)).digest("hex")],
     );
+    if (importRow.rowCount === 0) throw new ConflictError("duplicate_import", "this CSV content was already applied");
```
Lines: prod +10/-4 (adjustmentImport.ts +6/-4, migration +4 incl. 2 comment lines). Test +38 (new file).

## Why smallest
The INSERT is the first statement of the import transaction, so guarding it stops every ledger posting. `ON CONFLICT DO NOTHING` also serialises concurrent uploads (the second waits for the first to commit, then gets no row and a 409) without catching pg error codes or aborting the transaction. Rejected: a unique filename (pasted CSVs share `pasted.csv`, and a renamed file still doubles); an Idempotency-Key header (needs a client change and does not stop a re-upload); a hash of the raw text (formatting-only differences such as CRLF or a trailing newline would slip through). Hashing the parsed rows (merchantId, raw amount, reason) catches those. The hash is computed in the importer, not the route, so every caller is covered. Existing imports keep NULL and stay valid.

## Proof
Before: `IMP-2: an identical CSV re-upload (sequential and concurrent) posts only once` failed with `expected: 1, actual: 2` (both concurrent uploads applied). After: passes (one concurrent upload applies, the sequential re-upload rejects with `duplicate_import`, one import row, cache 4,750 fils). Neighbours green: adjustmentImport.test.ts, adminAdjustmentImport.test.ts, adjustmentCsvParsing.audit.test.ts (24/24).

## Regression risk
A legitimately repeated identical file (same merchants, same amounts, same reasons) now needs a changed reason cell. That is the intended trade-off: a deliberate repeat is rare and visible; an accidental one doubles money silently.

## Trap note
The "unique original_filename" comment describes a constraint that never existed.
