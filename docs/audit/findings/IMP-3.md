### IMP-3 · CSV import splits a thousands-separated amount and posts its first digit group · F7 · Severity: Medium

**What's wrong:** The adjustment CSV splitter cuts each row on every comma and keeps only cells 0-2. An unquoted `1,250.000` (the way finance sheets export a 1,250 BD figure) becomes amount `"1"` and reason `"250.000"`; with a reason column the real reason is dropped as a fourth cell. The import succeeds and posts 1.000 BD.

**Why it happens:** `apps/api/src/admin/adjustmentCsvParsing.ts:42` `split(",")`, then `:44` `amount = cells[1]` and `:48` `reason = cells[2]`. Nothing checks the cell count, and the format has no quoting. The docstring at `:19-24` promises "exactly three columns" but nothing enforces it. The route `POST /v1/admin/adjustment-imports` (`routes/admin.ts:86`, `routes/adminAdjustmentImport.ts:59`) posts every parsed row to the ledger.

**What it breaks:** Finance uploads `<merchant>,1,250.000,refund March`. The ledger gets a 1,000 fils credit instead of 1,250,000 fils: 1,249,000 fils short, with no error and an import row that looks valid. `<merchant>,-12,500` posts -12.000 BD instead of -12,500.000 BD. Reasons containing a comma are silently truncated.

**Why it needed a fix:** Case file F7 ("Something is wrong with how it reads BD amounts"): IMP-1 fixed the scaling; this is the other way the same import misreads a BD amount, and money must be right to the fils.

**Fix:** `apps/api/src/admin/adjustmentCsvParsing.ts:49-51`
```diff
     const reason = cells[2];
+    if (cells.length > 3 || /^\d{3}(\.\d*)?$/.test(reason ?? "")) { // IMP-3: "1,250.000" split into "1" + "250.000"
+      throw new BadRequestError("invalid_csv_row", `row ${i}: amounts and reasons must not contain commas`);
+    }
```
A row is rejected when it has more than the three documented columns, or when its reason is exactly a three-digit group (optionally with decimals), which is what is left of an amount after a thousands separator. The whole import is rejected with 400, the same way as the other row errors, so nothing is posted.

**Why this is the smallest correct fix:** one guard at the single place rows are split. *Why not parse quoted CSV or accept thousands separators?* Both change the documented format and need a CSV dependency or a parser; rejecting the ambiguous row fails closed and the operator removes the comma. *Why not only `cells.length > 3`?* `<id>,1,250.000` has three cells and still posts 1 BD. *Why not reject every numeric reason (the lead's regex)?* A reason such as `2026` or `12` would be refused for no reason; only a three-digit group is a thousands continuation. A reason that is exactly three digits (e.g. `123`) is now refused; that is ambiguous with `x,123` and is the safe side.

**Proof:** `IMP-3: an amount split by a thousands separator is rejected, not read as its first digit group` (`apps/api/src/admin/adjustmentCsvParsing.audit.test.ts`). Before the fix: `Missing expected exception.` (the row parsed as amount `"1"`). After: passes; `1250.000` with a reason still parses.

**Regression risk:** CSVs whose reason contains a comma are now rejected instead of truncated; `docs/ADMIN.md:66` documents a plain `merchantId,amount,reason` file and the docstring says three columns. `adjustmentCsvParsing.test.ts`, `adjustmentImport*.test.ts` and `routes/adminAdjustmentImport.test.ts` pass (45/45).

Lines: prod +3/-0, test +12/-1
