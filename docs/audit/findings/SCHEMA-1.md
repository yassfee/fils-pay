### SCHEMA-1 · Materialized view refund_merchant_summary joins refunds.id to transactions.id, so it is always empty · H1, FP-300 (☐5 "the reports") · Severity: Low (reported, not changed)

**What's wrong:** `refund_merchant_summary` (migration 0072) should give per-merchant, per-Bahrain-day refund totals. It joins each refund to a transaction on the wrong key, so no refund ever matches and the view has no rows.

**Why it happens:** `db/migrations/0072_refund_merchant_summary.sql:14` reads `JOIN transactions t ON t.id = r.id`. `refunds.id` is the refund's own `gen_random_uuid()` primary key (`0042_refunds.sql:15`), and the link to its transaction is `refunds.transaction_id` (`0042:16`). The two UUIDs never match, so the inner join drops every row. A second defect would show up as soon as the join was corrected: `SUM(t.captured_fils)` (`:12`) adds the transaction's captured amount once per refund row, so two partial refunds of one capture on the same day would double `original_captured_fils`. That is the same fan-out shape as SUM-1.

**What it breaks:** consider a merchant with one succeeded 3,333-fils refund (75 fils of fee reversed) on a 10,000-fils capture. After `REFRESH MATERIALIZED VIEW`, the view has 0 rows for that merchant, while the correct join finds 1 refund of 3,333 fils. Anything that read this view would show "no refunds". Today **nothing reads it**: the header says it is "refreshed by the reporting worker after each settlement run", but no code in `apps/` refreshes or queries it (`grep refund_merchant_summary` matches only the migration). The FP-300 reports read `refunds` and `merchant_daily_volume` directly.

**Why it needed a fix:** a reporting object that silently returns nothing is wrong by construction (data integrity: every refund must be counted). FP-300 ☐5 requires refunds to show up correctly in the reports. A future admin report built on this view would under-report refunds as zero.

**Fix:** not changed. Nothing consumes the view, so a fix changes no behaviour today, and it would need a new migration (an existing migration must never be edited) to recreate an unused object. What we would ship if a consumer is added (a new migration of about 14 lines; validated in a rolled-back transaction, see Proof):
```sql
DROP MATERIALIZED VIEW refund_merchant_summary;
CREATE MATERIALIZED VIEW refund_merchant_summary AS
WITH d AS (SELECT r.merchant_id, r.transaction_id, r.amount_fils, r.fee_reversed_fils,
                  date_trunc('day', r.occurred_at AT TIME ZONE 'Asia/Bahrain') AS business_date
             FROM refunds r WHERE r.status = 'succeeded')
SELECT d.merchant_id, d.business_date, COUNT(*) AS refund_count,
       SUM(d.amount_fils) AS total_refunded_fils, SUM(d.fee_reversed_fils) AS total_fee_reversed_fils,
       (SELECT SUM(t.captured_fils) FROM transactions t
         WHERE t.id IN (SELECT d2.transaction_id FROM d d2
                         WHERE d2.merchant_id = d.merchant_id AND d2.business_date = d.business_date)) AS original_captured_fils
  FROM d GROUP BY d.merchant_id, d.business_date;
CREATE UNIQUE INDEX idx_refund_merchant_summary_pk ON refund_merchant_summary (merchant_id, business_date);
```

**Why this is the smallest correct fix:** it corrects the join key, and it counts each refunded transaction's capture once per day instead of once per refund. *Why not drop the view?* Dropping it is also valid, but it deletes an object that someone may have planned to use. That is a product decision, not a bug fix.

**Proof:** in a rolled-back transaction on the w3g test DB, we inserted a merchant, a 10,000-fils captured transaction and a succeeded 3,333-fils refund, then ran `REFRESH MATERIALIZED VIEW refund_merchant_summary`. Result: `view rows for merchant|0`, while the `r.transaction_id` join returns `1|3333`. The replacement SQL above, run in the same way with two refunds (3,333 + 1,000 fils, fee 75 + 22) on one 10,000-fils capture, returns `2|4333|97|10000`: the capture is counted once.

**Regression risk:** none, because there is no code change.

Lines: prod +0/-0, test +0/-0
