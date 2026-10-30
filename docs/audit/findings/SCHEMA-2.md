### SCHEMA-2 · Three settlement money invariants have no database CHECK backstop · F1, ADR-0001, ADR-0002, FP-300 (☐2 "money is right in the ledger") · Severity: Low (reported, not changed)
**Lead:** Team 45 heads-up list (G10), verified by us.

**What's wrong:** settlement relies on three money invariants that only the Go writer upholds. The schema does not check any of them, so a bad write by a script, a hand-run SQL fix or a future code path would be stored silently:
1. `settlement_batches`: `net_payout_fils = gross_fils - fee_fils - refund_gross_fils + refund_fee_reversed_fils`, with `gross_fils, fee_fils >= 0`. `0006_settlement_batches.sql:10-12` and `0097` add the columns with no CHECK.
2. `refunds`: `fee_reversed_fils <= amount_fils`. `0042_refunds.sql:18-19` checks each column on its own (`> 0`, `>= 0`) but not the pair.
3. `scheme_export_lines`: `amount = amount_fils / 1000`. This is ADR-0002's rule, "the scheme file `amount` must be exactly `amount_fils / 1000` formatted to two decimals". `0050` added `amount NUMERIC(10,2)` with no tie to `amount_fils`. That gap let SCHEME-1 store a rounded-up `amount` next to a truncated `amount_fils` without any error.

**Why it happens:** the schema already backstops the neighbouring rules (`amount_fils % 10 = 0` in 0008, `refunded_fils <= captured_fils` in 0098, balanced ledger groups in 0007), but these three were left to the application. `LoadSchemeExportLines` (`apps/settlement/internal/settlement/scheme_export.go:71`) prefers the stored `amount` over `amount_fils`, so for invariant 3 the stored copy is what reaches the scheme file.

**What it breaks:** today, nothing. We checked every writer: `CloseBatch` (`batch.go:214-236`, `:254-257`) and `RecalculateMDR` (`recalculate_mdr.go:103-110`, which keeps net = net − diff, so the identity still holds) are the only code that writes batches and scheme lines, `processRefund` computes `fee_reversed_fils` cumulatively from `calculateRefundFee` (≤ the refund for any MDR below 100%), and the w3g test DB has 0 violating rows for all three. The risk is the next bypass. For example, a hand-run correction that sets `amount = 4.75` on a 4,740-fils line puts 10 extra fils on the scheme file, and nothing rejects it. That is exactly the F1 symptom.

**Why it needed a fix:** ADR-0001/0002 make these exact-fils rules. A CHECK turns a silent money error into a failed write. But no trusted source requires a schema-level check, and no live path violates them, so this is hardening, not a proven bug. That is why it is reported and not counted.

**Fix:** not changed. What we would add (one migration, next free number, about 6 lines):
```sql
ALTER TABLE settlement_batches ADD CONSTRAINT settlement_batches_net_identity CHECK (gross_fils >= 0 AND fee_fils >= 0
  AND net_payout_fils = gross_fils - fee_fils - refund_gross_fils + refund_fee_reversed_fils) NOT VALID;
ALTER TABLE refunds ADD CONSTRAINT refunds_fee_le_amount CHECK (fee_reversed_fils <= amount_fils) NOT VALID;
ALTER TABLE scheme_export_lines ADD CONSTRAINT scheme_export_lines_amount_is_fils CHECK (amount IS NULL OR amount = amount_fils::numeric / 1000) NOT VALID;
```
`NOT VALID` is required. Every production scheme line written before SCHEME-1 violates invariant 3, so a validating `ALTER` would fail the deploy. Once ops runs SCHEME-1's data repair (`UPDATE scheme_export_lines SET amount = amount_fils::numeric/1000 WHERE amount <> amount_fils::numeric/1000`), `VALIDATE CONSTRAINT` can follow.

**Why this is the smallest correct fix:** three declarative constraints on the tables that hold the figures, with no code change. *Why not triggers?* All three are single-row rules, which a CHECK covers. *Why not fix the seed or the readers instead?* They already comply, so there is nothing to fix there.

**Proof:** the three `ALTER TABLE ... NOT VALID` statements above, followed by `VALIDATE CONSTRAINT`, all succeed in a rolled-back transaction on the w3g test DB. Separately, `SELECT count(*)` returned 0 for each violation predicate: net identity, negative gross/fee, `fee_reversed_fils > amount_fils`, and `amount <> amount_fils/1000`. The seed writes `amount = truncated/1000` (`db/seed/generate.ts:536`, `:615`) and computes net = gross − fee for its closed batches (`:484-489`, `:589-596`), so it satisfies all three.

**Regression risk:** none, because there is no code change. If the migration is added later, a currently correct writer cannot trip it. The only failure mode is a deploy without `NOT VALID`.

Lines: prod +0/-0, test +0/-0
