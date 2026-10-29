### IMP-1 · CSV adjustment import reads BD as 2-decimal "cents" (10x too small) · F7 · Severity: Critical
**What's wrong:** Every amount in the admin CSV adjustment import is posted to the ledger at one tenth of its value, and the third decimal is silently dropped: "4.75" BD posts 475 fils (0.475 BD) and "4.755" also posts 475.

**Why it happens:** `parseAdjustmentAmountFils` (`apps/api/src/admin/adjustmentCsvParsing.ts:8`) called `parseDecimalMinor(raw)`, whose default is `decimals = 2` (`apps/api/src/lib/decimal.ts:4`). It pads/slices the fraction to 2 digits (`decimal.ts:16`) and glues it to the integer part: "4.75" → "4"+"75" → 475, "4.755" → "4"+"75" → 475. The result is a count of hundredths of a BD, which `toFils` then brands as fils. The faulty assumption is "BD has 2 decimals" (the quarantined CLAUDE.md said "1 BD = 100 cents"); the case file and ADR-0001 say 1 BD = 1000 fils and require `parseBhdToFils`.

**What it breaks:** Both readings in Finance's F7 note come from this one bug: read as 2-dp, 475 looks like "4.750" (4.755 → 4.750); read as fils it is 0.475 BD ("ten times less"). Each row posts a balanced ledger group (merchant_payable vs manual_balance_adjustment_contra) and a cache delta 10x too small. Worked number: 4.75 BD → 475 fils instead of 4,750 (−4,275 fils per row). The 2026-08-27 import (sheet 4,141.90 BD) posted 414,190 fils = 414.190 BD, so 3,727.710 BD of corrections never reached the ledger.

**Why it needed a fix:** Every manual correction finance makes is 90% lost; merchants are under- or over-credited and the ledger silently disagrees with finance's spreadsheet.

**Fix:** `apps/api/src/admin/adjustmentCsvParsing.ts`
```diff
-import { toFils, type Fils } from "@filspay/money";
+import { parseBhdToFils, type Fils } from "@filspay/money";
-import { parseDecimalMinor } from "../lib/decimal.js";
-    return toFils(parseDecimalMinor(raw), { allowNegative: true });
+    return parseBhdToFils(raw); // ADR-0001: BD x1000, signed, rejects >3 decimals (was 2-dp "cents")
```
plus the misleading comment at `apps/api/src/routes/adminAdjustmentImport.ts:57`. Commit: see summary table. Lines: prod +3/−4 (incl. 1 comment line), test +20/−8.

**Why this is the smallest correct fix:** one call swap at the single parsing point, reusing the ADR-0001 parser that already exists in `packages/money`. Its errors are still caught and mapped to 400 `invalid_amount`. Why not change `decimals = 2` to `3` in `decimal.ts` (1 line)? It would still silently truncate a 4th decimal ("4.7555" → 4755) instead of rejecting it, and it keeps a second, non-canonical money parser alive. Why not delete `lib/decimal.ts` (now unused)? It adds deleted lines and fixes nothing more.

**Proof:** `adjustmentCsvParsing.audit.test.ts` "CSV import amounts are BD with 3 decimals" fails before (`expected: 4750, actual: 475`) and passes after. Corrected assertions that encoded the bug: `adjustmentImport.test.ts:61,67,70,125,126,148` (600→6000, 475→4750, 125→1250, 350→3500, 500→5000) and `routes/adminAdjustmentImport.test.ts:108` (600→6000). Import suites: 32/32 pass.

**Regression risk:** only the CSV import path calls this function (grep). Inputs with thousands separators ("1,250.000") are now rejected as `invalid_amount` instead of being mis-split (IMP-3 is the separate splitter bug). Past imports remain wrong in the ledger: `adjustment_import_rows.raw_amount_text` (0066) allows a one-off, per-row idempotent correcting journal (parseBhdToFils(raw) − parsed_amount_fils), which is a finance decision and not run here.

**Trap note:** `routes/adminAdjustmentImport.ts:57` "FH: parseAdjustmentCsv handles 3dp BD amounts correctly (4.750 -> 4750 fils), Claude checked" (false; corrected in place). `routes/adminAdjustmentImport.test.ts:236-238` "4.75 -> 475 ... matches the README" / "2dp by agreement with finance" (annotated). Six test assertions pinned the 10x value; 6f462e1 "mark import amounts as intentional" is an empty commit (MK, "Per Rule 3").
