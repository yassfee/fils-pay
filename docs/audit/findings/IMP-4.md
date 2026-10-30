### IMP-4 · CSV adjustment import answers an unknown merchant or a NUL byte with a 500 · F7 · Severity: Low

**Lead:** Team 45 heads-up list (Q3-03), verified by us.

**What's wrong:** `POST /v1/admin/adjustment-imports` checks that each merchant id is UUID-shaped, but not that the merchant exists, and it passes reason text straight to Postgres. A typo'd (well-formed) merchant id, or a NUL byte pasted from a spreadsheet, makes the import fail with an unhandled 500 halfway through its transaction instead of a 4xx that tells finance which row is wrong.

**Why it happens:** `apps/api/src/routes/adminAdjustmentImport.ts:62-66` validates only `UUID_RE`. `applyAdjustmentImport` (`apps/api/src/admin/adjustmentImport.ts:55-79`) then inserts ledger legs per row; for an unknown id the `ledger_entries`/`merchant_balances` foreign key raises inside the loop, which the error handler turns into 500. The parser (`adjustmentCsvParsing.ts:41-49`) keeps any byte in the reason, and Postgres rejects `\u0000` in `text` (`invalid byte sequence`), again a 500.

**What it breaks:** Finance uploads 40 correction rows and one id has a typo: the response is `500 internal_error` with no row number; the transaction rolls back, so no money moves, but the operator cannot tell what to fix and support sees a server fault. Reproduced by the test below (`expected: 404, actual: 500`).

**Why it needed a fix:** F7 is about this import misreading finance's sheets; a bad row must be rejected clearly before anything is posted, as the import already does for malformed ids and amounts.

**Fix:** `apps/api/src/admin/adjustmentImport.ts:6,56-58` and `apps/api/src/admin/adjustmentCsvParsing.ts:42-44`
```diff
   return withTransaction(pool, async (client) => {
+    const ids = [...new Set(input.rows.map((r) => r.merchantId))]; // IMP-4: an unknown merchant is a 404, not an FK 500 mid-import
+    const known = await client.query(`SELECT 1 FROM merchants WHERE id = ANY($1::uuid[])`, [ids]);
+    if (known.rowCount !== ids.length) throw new NotFoundError("merchant_not_found");
```
```diff
   for (let i = 1; i < lines.length; i++) {
+    if ((lines[i] as string).includes("\u0000")) {
+      throw new BadRequestError("invalid_csv_row", `row ${i} contains a NUL byte`); // IMP-4: Postgres text cannot store it (was a 500)
+    }
```
The merchant check runs once, before the import row and any ledger leg is written, and answers with the same `merchant_not_found` 404 the credit and balance routes use. The NUL check sits with the parser's other row checks.

**Why this is the smallest correct fix:** one set query instead of a per-row lookup, and one row check in the existing loop. *Why not catch the FK error and map it?* That relies on the constraint name and still fails mid-transaction. *Not done, reported as policy questions:* rejecting zero-amount rows (the code documents them as allowed, `adjustmentImport.ts:108` "null for a zero-amount row"); requiring a reason (the repo's own `adjustmentCsvParsing.test.ts` "a row with no reason column omits the reason" pins it as optional); and capping rows at `CREDIT_APPROVAL_THRESHOLD_FILS` (50.000 BD) to stop the import bypassing maker-checker, which would refuse the `120.00` BD amount `docs/ADMIN.md:66-67` gives as a normal import value. Each changes a documented contract and needs a product decision.

**Proof:** `IMP-4: an unknown merchant id is a 404 and a NUL in a reason is a 400; nothing is applied` (`apps/api/src/routes/adminAdjustmentImport.test.ts`). Before the fix: `expected: 404, actual: 500`. After: 404 `merchant_not_found` and 400 `invalid_csv_row`, and no ledger leg for the merchant. Import route, import and CSV parsing tests pass (35/35).

**Regression risk:** Only requests that used to 500 change. Valid imports run one extra indexed query.

Lines: prod +7/-1 (adjustmentImport.ts +4/-1, adjustmentCsvParsing.ts +3), test +15/-0
