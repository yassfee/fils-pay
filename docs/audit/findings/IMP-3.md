### IMP-3 · CSV import: an unquoted comma inside an amount splits it into amount + reason (format ambiguity) · F7 · Severity: Low (reported, not changed)

**Category:** Reported, not changed

**What the behaviour is:** the adjustment CSV splitter cuts each row on every comma and keeps cells 0-2 (`apps/api/src/admin/adjustmentCsvParsing.ts:45-51`); a fourth cell is dropped without an error. The format has no quoting (docstring `:18-23`: "no quoting, no embedded newlines, and exactly three columns"). So an unquoted `<merchant>,1,250.000` (a thousands separator) is read as amount `1` and reason `250.000`, and posts 1.000 BD. The same file shape is also a valid row: amount 1 BD with the reason "250.000". The parser cannot tell the two apart.

**Relation to F7:** F7's symptom ("I uploaded 4.75 BD and it shows 0.475. That's ten times less") is IMP-1, the BD-as-cents scaling, which stays fixed. This note is not F7; F7 is cited only because it is the same import.

**What the reverted fix did:** `f181469` (prod +3/-0) rejected a row with more than three cells, or whose reason was exactly a three-digit group (optionally with decimals), with 400 `invalid_csv_row`.

**Why it was reverted (`6ec6d8c`):** the heuristic rejected valid input. A row with a purely numeric reason such as `123` (a ticket or invoice number) is legal under the documented `merchantId,amount,reason` format (`docs/ADMIN.md:65-66`) and was refused. A guess at the operator's intent should not reject legal rows, so the code and its test were reverted in full.

**What a correct fix needs:** a format rule, decided by the owner and written into `docs/ADMIN.md`, that removes the ambiguity. For example:
- quoted CSV fields (an RFC 4180 parser), so `"1,250.000"` is one cell; or
- a rule that the reason must contain a non-digit, so a bare number in the third column can be refused as a split amount; or
- refusing a row with more than three cells (this half is unambiguous and could ship on its own once the reason rule is settled).

**Related:** Q2 (decimal comma, the same ambiguity), IMP-1 (F7 scaling, fixed).

Lines: prod +0/-0, test +0/-0 (fix `f181469` prod +3/-0, test +12/-1, fully reverted in `6ec6d8c`)
