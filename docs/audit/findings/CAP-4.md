### CAP-4 · Every capture scans the whole ledger four times and the whole holds table once, so checkout capacity falls as the ledger grows ·  · Severity: High

**What's wrong:** `ledger_entries` has no index on `entry_group_id`, and `holds` has none on `transaction_id`. Both columns are looked up once per row on the checkout hot path. Each lookup is therefore a sequential scan of the whole table, and those tables only grow.

**Why it happens:** The double-entry guard `ledger_entries_balance` (`db/migrations/0007_ledger_double_entry.sql:67-70`) is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger `FOR EACH ROW`. At COMMIT, `check_ledger_group_balance()` runs `SELECT ... FROM ledger_entries WHERE entry_group_id = v_group_id` once for every inserted row. A capture inserts 4 rows (`payments/capture.ts:215-235`: the gross pair and the MDR fee pair). The same capture runs `UPDATE holds SET status = 'released' WHERE transaction_id = $1` (`capture.ts:244`). The only indexes on these tables are `ledger_entries (id)`, `ledger_entries (merchant_id, occurred_at)` and `holds (id)`.

**What it breaks:** Throughput, and it gets worse over time. On the local box emulation (API 0.5 vCPU / 512 MB, Postgres 0.6 vCPU), Postgres sat at its CPU cap at about 16 checkouts/s, and samples of `pg_stat_activity` were dominated by `COMMIT`, where the deferred trigger runs. After about 6,000 load-test checkouts, `pg_stat_user_tables` showed `ledger_entries` with 37,074 sequential scans that had read 531,924,194 tuples and 0 index scans, and `holds` with 6,148 sequential scans that had read 18,942,066 tuples. The cost per checkout is linear in the size of the ledger. Every payment the judges make, and every row the seed creates, makes the next checkout slower.

**Why it needed a fix:** Capacity is scored as users served while staying fast. Here capacity was capped by an O(ledger size) scan, not by the 0.5 vCPU / 512 MB limits, and it would shrink during the judges' own load test.

**Fix:** `db/migrations/0101_hot_path_indexes.sql` (new, add-only)
```sql
CREATE INDEX IF NOT EXISTS ledger_entries_entry_group_id_idx ON ledger_entries (entry_group_id);
CREATE INDEX IF NOT EXISTS holds_transaction_id_idx ON holds (transaction_id);
```

**Why this is the smallest correct fix:** Two indexes, no code change. The trigger keeps its exact semantics, and so does the double-entry guarantee (case file / ADR-0001). *Why not make the trigger `FOR EACH STATEMENT`, or check once per group?* That rewrites a money-safety guard. An index makes the same check O(log n). *Why not drop the trigger and rely on application code?* It is the only database-enforced double-entry check. *Why not `CREATE INDEX CONCURRENTLY`?* The migration runner wraps each file in a transaction, and both tables are small at deploy time (about 14k and 2k rows after the seed), so the lock lasts well under a second. The cost is about 40 bytes of index per ledger row and one extra index write per insert. The scans this removes are a full table each.

**Proof:**
- `CAP-4: the balance trigger's and the hold release's lookups use an index, not a full table scan` (`scripts/hot_path_indexes.audit.test.ts`), with sequential scans disabled. Before the migration the plan was a `Seq Scan` on `ledger_entries` (`not ok 1`). After `npm run migrate` it passes, and `scripts/ledger_append_only.audit.test.ts` still passes.
- Load test (same box emulation, Postgres 0.6 vCPU, 30 s steps; full tables in `docs/audit/CAPACITY.md`):

| users | before: checkouts/s, pay p95 | after: checkouts/s, pay p95 |
|---:|---|---|
| 10 | 14.2, 971 ms | 17.6, 749 ms |
| 20 | 16.5, 1,488 ms | 24.7, 1,106 ms |
| 30 | 13.9, 2,500 ms | 27.9, 1,418 ms |

After the index, the run (about 6,000 more checkouts) shows `ledger_entries` with 0 sequential scans and 16,045 index scans, and `holds` with 1 sequential scan and 4,011 index scans.

**Regression risk:** Add-only, with `IF NOT EXISTS`, so it is safe to re-run. Inserts into `ledger_entries` and `holds` maintain one more B-tree. No query changes, so results are identical.

Lines: prod +4/-0 (migration), test +33/-0
