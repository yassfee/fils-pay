### NOTIFY-1 · settlement.paid enqueue is check-then-insert with no unique key, so concurrent runs double-notify · INC-2026-08-21 · Severity: High
**Category:** Bug

**Case attribution:** this is the case file's INC-2026-08-21 ("Shops got two 'your payout is on the way' messages for the same payout. Two processes checked at the same time, and both thought they were first."): a check-then-insert by two processes. CW-1 (duplicate rows in the write-only disbursement table) no longer claims this incident.

**What's wrong:** `EnqueuePayoutNotifications` selects paid batches `WHERE NOT EXISTS (settlement.paid outbox row)` and then INSERTs, with no lock and no unique key. Two enqueuers (the daemon tick and a `run-batch` CLI run) both pass the check and both insert, so the merchant receives `settlement.paid` twice.

**Why it happens:** `apps/settlement/internal/settlement/payout_notify.go:29-95`. Under READ COMMITTED, neither transaction sees the other's uncommitted row. The comment at `:27` quoted "claude: No, outbox_events has a unique index on (event_type, aggregate_id)", but migration 0009 only has `idx_outbox_unprocessed` (non-unique). MK's "daemon and CLI never overlap" (`:28`) is contradicted by INC-2026-08-21.

**What it breaks:** duplicate `settlement.paid` webhooks per batch. A merchant whose integration books a payout per webhook records the payout twice (e.g. 9,750 fils booked as 19,500 fils), which is exactly incident INC-2026-08-21.

**Why it needed a fix:** any overlap of the daemon and an operator re-run (or two daemon replicas) repeats the incident, and the in-code claim that the database prevents it is false.

**Fix:** `payout_notify.go:86-93` + new `db/migrations/0092_outbox_settlement_paid_unique.sql`
```diff
-		_, err = db.Exec(ctx, `
+		tag, err := db.Exec(ctx, `
-			VALUES ('settlement.paid', 'settlement_batch', $1, $2)
+			VALUES ('settlement.paid', 'settlement_batch', $1, $2) ON CONFLICT DO NOTHING
-		count++
+		count += int(tag.RowsAffected())
```
```sql
UPDATE outbox_events oe SET event_type = 'settlement.paid.duplicate', processed_at = COALESCE(processed_at, now())
 WHERE event_type = 'settlement.paid' AND id > (SELECT min(id) FROM outbox_events o2 WHERE o2.event_type = 'settlement.paid' AND o2.aggregate_id = oe.aggregate_id);
CREATE UNIQUE INDEX outbox_events_settlement_paid_once ON outbox_events (aggregate_id) WHERE event_type = 'settlement.paid';
```
The `:27` comment is replaced with the real mechanism.
Commit: this commit. Lines: prod +4/-4 Go (3 code lines, 1 comment line) and +15 SQL (migration, including 6 comment lines), test +48/-0.

**Why this is the smallest correct fix:** the database is the only place that can serialize two separate processes. The partial unique index makes the second INSERT wait for the first and then skip (`ON CONFLICT DO NOTHING`), and `RowsAffected` keeps the returned count honest. The index is partial, so no other event type is constrained. Why not an advisory lock or SELECT ... FOR UPDATE: the function has no transaction, and adding one is a bigger change that still relies on every caller using the lock. Why not a full unique index on (event_type, aggregate_id): other event types may legitimately repeat per aggregate. The UPDATE in the migration is needed because production already holds INC-2026-08-21 duplicates (my red-phase run created one locally, and the bare index failed with `Key (aggregate_id)=(...) is duplicated`). Later duplicates are relabelled `settlement.paid.duplicate` and marked processed instead of being deleted, so audit history and any FK references survive and nothing is dispatched again.

**Proof:** `TestEnqueuePayoutNotifications_ConcurrentEnqueueIsSingle` (payout_notify_audit_test.go) holds an uncommitted competing `settlement.paid` insert while the enqueuer runs. It failed before: `settlement.paid events for one batch = 2, want 1`. It passes after migration 0092; `go test ./internal/settlement/` is green.

**Regression risk:** single-runner behaviour is unchanged (NOT EXISTS still filters). A concurrent enqueuer now blocks briefly on the index and then skips. Readers that count `settlement.paid` rows see one per batch. The relabelled historical rows keep their payloads.

**Trap note:** the "claude: ... has a unique index" comment (`:27`) was false; it is replaced, and FP-260 "resolved" (daemon.go:105) refers to the same unfixed race.
