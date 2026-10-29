### SUM-2 · No index serves batched capture events by time, so the settlement summary scans transaction_events · H6 · Severity: Medium

**What's wrong:** The summary filters the merchant on `transactions` and the window on `transaction_events.occurred_at`, but no index serves an `occurred_at` range once events have been batched.

**Why it happens:** The only `occurred_at` index, `idx_transaction_events_unbatched` (`db/migrations/0023_transaction_events_settlement_batch.sql:15-18`), is partial on `settlement_batch_id IS NULL`, so it stops covering an event as soon as CloseBatch claims it; the other is `(transaction_id, occurred_at)` (`0018_transaction_events.sql:23`), whose leading column the window cannot use. For a large merchant the planner hashes all of the merchant's transactions and scans transaction_events (perf doc: 402,911 rows, 1.84 s of 3.4 s). `applyBatchClosed`'s parity query (`apps/reporting/src/consumer/applyEvent.ts:131-139`) has the same shape. `docs/perf/2026-07-settlement-summary-slow.md` blamed buffers; raising `shared_buffers` only cached the same scan.

**What it breaks:** 3-6 s `/v1/settlement/summary` responses for the largest merchant (the spinning settlement page), each holding an API pool connection, and growing with table size; the nightly batch_closed burst repeats the scan in the reporting consumer.

**Why it needed a fix:** H6: latency scales with total history instead of the requested window.

**Fix:** new `db/migrations/0088_transaction_events_captures_by_time.sql`:
```sql
CREATE INDEX idx_transaction_events_captures_by_time
    ON transaction_events (occurred_at) INCLUDE (transaction_id, amount_fils)
 WHERE event_type IN ('captured', 'partially_captured');
```
Combined with SUM-1 (the CTE now reads `te.amount_fils`), the window is an index-only range scan hash-joined to the merchant's transactions. Commit: this commit. Lines: prod +7/-0 (SQL, 4 of them comments), test +23/-0.

**Why this is the smallest correct fix:** one partial covering index that matches both the predicate (`event_type IN (...)`, `occurred_at` range) and every column the two queries read; no query change. Why not denormalise `merchant_id` onto `transaction_events` with `(merchant_id, occurred_at)`: the scalable follow-up, but a column + backfill + producer changes. Why not `CONCURRENTLY`: `db/migrate.ts` wraps each file in BEGIN/COMMIT; on a large production table run this statement manually with `CONCURRENTLY` before deploying (the migration then must be marked applied) or accept a write lock for the build.

**Proof:** `settlement/query.audit.test.ts` "summary SQL can use idx_transaction_events_captures_by_time for the occurred_at window" runs `EXPLAIN (FORMAT JSON)` on the real summary SQL (seqscan and nestloop disabled, i.e. the large-merchant hash-join plan): before, the plan was a Bitmap Index Scan on `idx_transaction_events_transaction` with a heap recheck/filter and the assertion failed; after migrating it uses `idx_transaction_events_captures_by_time`. `routes/settlement.test.ts` + audit tests 12/12.

**Regression risk:** extra write cost on capture inserts only (partial index); the build locks writes on `transaction_events` while it runs (see above). No query semantics change.

**Trap note:** the perf doc's "it's buffers" conclusion (not owned) is contradicted by this plan evidence.
