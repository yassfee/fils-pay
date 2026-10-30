### GO-1 · One capture of 100,000,000 BD or more overflows the scheme amount column and stops the daily close for every merchant after it · ADR-0001, ADR-0002, case file p.1 ("settlement closes every day at midnight") · Severity: Low

**What's wrong:** `scheme_export_lines.amount`, the two-decimal copy of each scheme line, is `NUMERIC(10,2)`, so its ceiling is 99,999,999.99 BD. A scheme line is a truncated `BIGINT` fils figure with no upper bound. When a merchant's line for the day reaches 100,000,000.00 BD, `CloseBatch` fails with `numeric field overflow`. That merchant's day can then never be closed, and because the daily run stops at the first error, no merchant sorted after it is closed or paid that day either.

**Why it happens:** `db/migrations/0050_scheme_export_lines_acquirer_amount.sql:13` added `amount NUMERIC(10, 2)`. `CloseBatch` writes `$3::bigint::numeric / 1000` into it for every line (`apps/settlement/internal/settlement/batch.go:254-257`). Nothing upstream caps the amount: `POST /v1/transactions` only applies `toFils` (safe integer, `apps/api/src/routes/transactions.ts:78`), and `transactions.amount_fils` is `BIGINT`. The error then propagates:
- `RunDailyBatch` returns on the first non-eligibility error (`batch.go:439-449`), with merchants processed in UUID order (`:436`).
- The daemon logs the error and returns before `EnqueuePayoutNotifications` (`scheduler/daemon.go:94-97`), and it fails the same way on every poll that day.
- `run-batch --date` and `POST /internal/run-batch` fail the same way.

**What it breaks:** merchant A captures 100,000,000.005 BD (100,000,000,005 fils) on 26 March. Its scheme line is 100,000,000,000 fils, which needs `100000000.00` (9 integer digits) in a column that allows 8. A's close rolls back, so A's payout never happens, and the day cannot be closed by any re-run. Merchant B, whose UUID sorts after A, captured 10,000 fils (net 9,750 at 250 bps) that day. B gets no batch, no payout and no notification until an operator notices and runs `run-batch --merchant=B` by hand. Every other money column is `BIGINT` (ADR-0001), so this column is the only one with a range smaller than the fils domain.

**Why it needed a fix:** ADR-0001 makes every amount an integer number of fils in `BIGINT`, and ADR-0002 makes the scheme amount exactly `amount_fils / 1000` at two decimals. A two-decimal copy that cannot represent a valid fils figure breaks that rule. The case file requires settlement to close every day. Here one merchant's legitimate (if very large) capture stops other merchants' payouts.

**Fix:** new migration `db/migrations/0103_scheme_export_lines_amount_precision.sql`
```sql
ALTER TABLE scheme_export_lines ALTER COLUMN amount TYPE NUMERIC(18, 2);
```
(plus a 3-line header comment). Precision 18 at scale 2 holds every int64 fils / 1000 (at most 9,223,372,036,854,775.80 BD truncated to 10 fils).

**Why this is the smallest correct fix:** one DDL statement at the cause, with no Go change. Raising numeric precision at the same scale keeps every stored value and does not rewrite the table (checked: `pg_relation_filenode` is unchanged across the `ALTER`, and `4.74` stays `4.74`), so the deploy is instant. Alternatives we rejected:
- *Make `RunDailyBatch` skip a failing merchant and continue.* That would contain the blast radius, but merchant A's day still could never close. It also changes the run's error contract for every failure type. It is a separate hardening decision.
- *Cap amounts at authorization.* That is a checkout-path change, which is out of scope, and it does not help rows that already exist.
- *Stop writing `amount`.* The reader then falls back to `amount_fils::numeric / 1000`, whose text form has 16 decimals, not 2.

**Proof:** `TestCloseBatch_SchemeAmountHoldsLargeLine` (`apps/settlement/internal/settlement/scheme_amount_range_audit_test.go`) closes a past Bahrain day holding one 100,000,000,005-fils capture. Before the migration it fails with `CloseBatch: settlement: CloseBatch: insert scheme export line: ERROR: numeric field overflow (SQLSTATE 22003)`. After the migration it passes, and the line is `100000000000` fils / `"100000000.00"`. The test restores `platform_stats.total_processed_fils` on cleanup, so the FEES-1 volume tier other suites rely on is untouched. `TestSchemeExportAmountIsTruncatedFils` and `TestSchemeExportAmountHasTwoDecimals` still pass.

**Regression risk:** the column only widens, so every existing value and every reader (`LoadSchemeExportLines` casts it to text) behaves as before. Out of scope and not changed: whether the acquirer's clearing file accepts amounts this large. That is a scheme-format question, like ADR-0002's open "verify residue with Visa" item.

Lines: prod +4/-0 (1 DDL statement + 3 comment lines), test +40/-0
