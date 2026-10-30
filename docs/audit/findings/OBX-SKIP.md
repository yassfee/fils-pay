### OBX-SKIP · Reporting outbox watermark follows id order, not commit order: late-committing events are skipped forever · FP-300 ☐5 · Severity: High

**What's wrong:** The reporting consumer read `id > last_processed_id ORDER BY id` and moved the watermark to the highest id it applied. An outbox id is taken from the BIGSERIAL when the row is inserted, not when its transaction commits, so a lower id can become visible after a higher id was already consumed. That event is then never selected again: its capture, void, batch close or refund never reaches `merchant_daily_volume` / `merchant_payout_trends`.

**Why it happens:** `apps/reporting/src/consumer/runConsumerPass.ts:46-61` (before): `WHERE id > $1 ... ORDER BY id ASC`, then `if (rowId > maxId) maxId = rowId` and `advanceCursor`. `outbox_events.id` is `BIGSERIAL` (`db/migrations/0009_outbox_events.sql:6`). Capture inserts its event (`apps/api/src/payments/capture.ts:240`) and keeps working (transaction event, idempotency completion) before it commits; `CloseBatch` (`apps/settlement/internal/settlement/batch.go:277`) and the refund path do the same. Meanwhile another transaction inserts a higher id and commits; its AFTER INSERT `pg_notify` (`0021_webhook_endpoints.sql:30-38`) starts a pass right away, and that pass's snapshot sees the higher id but not the lower one. Yousif's handover lists this as unfinished: "outbox consumption by commit order instead of id (the xid8 query is in a gist)" (`docs/HANDOVER.md:66-68`).

**What it breaks:** Capture A (25,000 fils for merchant X) inserts outbox id 1001 and is still committing; capture B (1,000 fils, merchant Y) inserts 1002 and commits. The NOTIFY pass applies 1002 and stores watermark 1002. A commits; `id > 1002` never returns 1001. X's day in `merchant_daily_volume` is short 1 capture and 25,000 fils for good; only a full `reporting rebuild` repairs it. It happens under ordinary concurrency, silently, and FP-300 refund events are dropped the same way. Reproduced by the test below: X has no rollup row at all.

**Why it needed a fix:** FP-300 "Done when" ☐5: the feature must show up right in the reports. A consumer that loses events under normal load cannot meet that, and it also feeds the reconciliation views.

**Fix:** new `db/migrations/0100_outbox_events_txid.sql` and `apps/reporting/src/consumer/runConsumerPass.ts:49-50,52,62`
```diff
+ALTER TABLE outbox_events ADD COLUMN txid xid8 NOT NULL DEFAULT pg_current_xact_id();
+CREATE INDEX idx_outbox_events_txid_id ON outbox_events (txid, id);
```
```diff
-        WHERE id > $1
+        WHERE (txid, id) > (COALESCE((SELECT txid FROM outbox_events WHERE id = $1), '0'), $1::bigint)
+          AND txid < pg_snapshot_xmin(pg_current_snapshot()) -- OBX-SKIP: commit-safe order, finished txs only
           AND event_type = ANY($2::text[])
-        ORDER BY id ASC
+        ORDER BY txid, id
 ...
-      if (rowId > maxId) maxId = rowId;
+      maxId = rowId; // OBX-SKIP: the watermark is the last row in (txid, id) order, not the highest id
```
Every outbox row now records the transaction that inserted it (the column default, so the api's `enqueueEvent` and both Go writers need no change). A pass reads only rows whose `txid` is below its snapshot's xmin: every such transaction has finished, so no row can later appear behind the watermark. Rows are applied in `(txid, id)` order and the watermark is the last row applied; its `txid` is looked up from the row itself, so `last_processed_id` stays the only cursor and `reporting_outbox_cursor`, `advanceCursor`, `resetCursor` and rebuild are unchanged. Existing rows all get the migration's txid, so the stored watermark keeps its exact meaning across the deploy (rows with a higher id are still pending). A fresh or reset cursor (id 0) starts at txid 0.

**Why this is the smallest correct fix:** it is the approach the original developer had designed (handover) and changes one query and one assignment. *Why not stop at the first gap in ids?* Rolled-back inserts leave permanent gaps, so the consumer would stall. *Why not `LOCK TABLE outbox_events IN SHARE MODE` in the pass (one line)?* It waits for every in-flight capture and blocks all new captures, refunds and batch closes while reporting runs, coupling payments to the read model. *Why not the xmin filter alone with id order?* A transaction can take its xid before an older one but insert its outbox row later, so id order and xid order still disagree. *Why not a `last_txid` column on the cursor (the lead's version)?* Three more functions change, and the cursor would have two fields that can disagree (anything that sets `last_processed_id` alone would desynchronise it); looking the txid up from the watermark row keeps one source of truth. Outbox rows are never deleted by any code path (grep), and `webhook_deliveries` holds a foreign key to them.

**Proof:** `OBX-SKIP: an event whose transaction commits after a higher id was consumed is still applied` (`apps/reporting/src/consumer/runConsumerPass.test.ts`): a client holds an uncommitted `transaction.captured` (lower id, 25,000 fils, merchant X), a second capture commits with the higher id, a pass runs, the first transaction commits, a second pass runs. Before the fix: `merchant late must have its capture rolled up` / `0 !== 1` (no rollup row for X). After: passes; both merchants show `captured_count = 1`. The reporting suite passes 16/16, including the OBX-DOUBLE overlap test and the atomicity test.

**Regression risk:** a long-running transaction anywhere on the database cluster holds the snapshot xmin back, so newer events wait (delayed, never lost) until it ends; that is the inherent cost of commit-safe consumption and the poll timer retries. Events in one pass may be applied in txid order instead of id order; every rollup write is an additive upsert, so order does not change the result. The 0100 `ADD COLUMN` takes an ACCESS EXCLUSIVE lock on `outbox_events` briefly (fast default, no table rewrite). Requires PostgreSQL 13+ (`xid8`); the stack runs 16. If someone deleted the outbox row the watermark points at, the lookup would fall back to txid 0 and replay; no code deletes outbox rows.

**Trap note:** `runConsumerPass.ts:45` ("ids come from a sequence, they're monotonic. fine for now") and `0030_reporting_outbox_cursor.sql:16` ("id order is fine here, the api is the only writer") are false: ids are monotonic in insert order, not commit order, and settlement also writes outbox rows. The docstring's "identical posture to webhooks/dispatcher.ts's Step A" was misleading: the dispatcher anti-joins `webhook_deliveries` and has no watermark.

Lines: prod +9/-3 (runConsumerPass.ts +4/-3; migration 0100 +5, of which 3 are comment lines), test +35/-0
