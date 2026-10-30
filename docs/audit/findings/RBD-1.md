### RBD-1 · Admin "Rebuild analytics" double-applies the reporting backlog and wipes the FP-300 refund columns · FP-300 ☐5 · Severity: Medium

**What's wrong:** `POST /v1/admin/reporting/rebuild` (the admin console's "Rebuild analytics" button) truncates `merchant_daily_volume` and `merchant_payout_trends` and refills them with `INSERT … SELECT` from `transaction_events` and `settlement_batches`. It never touches the reporting worker's watermark, so every outbox event the worker had not yet consumed is already counted by the rebuild and is then applied again by the worker. It also never writes the FP-300 refund columns (`refund_count`, `refund_gross_fils`, migration 0099), so every refund disappears from the reports.

**Why it happens:** `apps/api/src/admin/reportingRebuild.ts:11-39` (before) has no reference to `reporting_outbox_cursor` or `refunds`. The worker (`apps/reporting/src/consumer/runConsumerPass.ts`) resumes from its own watermark and applies each event with additive upserts (`applyEvent.ts`), so a backlog event reflected by the rebuild is counted twice. `docs/ADMIN.md:83-85` tells support to press the button exactly when dashboards look stale, i.e. when the backlog is largest. The route's own docstring (`routes/admin.ts:227-231`, "replays the outbox from the start") describes a design the code never had.

**What it breaks:** One unconsumed capture of 10,000 fils and one unconsumed refund of 1,500 fils. After the button the merchant's day shows 1 capture / 10,000 fils and 0 refunds; after the next worker pass it shows 2 captures / 20,000 fils and 1 refund / 1,500 fils. Without the watermark move it would even be 2 refunds / 3,000 fils. With the consumer 2,000 captures (50,000.000 BD) behind, those days show 100,000.000 BD.

**Why it needed a fix:** FP-300 ☐5: refunds must show up right in the reports. A maintenance button that wipes them and doubles the backlog breaks that every time support uses it as documented.

**Fix (advisor option c, response contract unchanged):** `apps/api/src/admin/reportingRebuild.ts:2,13-17,44-51`
```diff
+import { ConflictError } from "../lib/errors.js";
 ...
+  // RBD-1: one snapshot for the rebuild and the outbox watermark it covers; the reporting worker waits on its cursor.
+  await client.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
+  await client.query(`LOCK TABLE reporting_outbox_cursor IN EXCLUSIVE MODE`);
+  const straddling = await client.query(`SELECT 1 FROM outbox_events WHERE txid >= pg_snapshot_xmin(pg_current_snapshot()) AND event_type IN ('transaction.captured', 'transaction.voided', 'settlement.batch_closed', 'refund.succeeded') LIMIT 1`);
+  if (straddling.rows.length > 0) throw new ConflictError("reporting_rebuild_busy", "payments are committing out of order right now; retry in a moment");
 ... (TRUNCATEs and the two existing INSERT … SELECTs unchanged)
-  return { volumeRows: volumeResult.rowCount ?? 0, trendRows: trendResult.rowCount ?? 0 };
+  await client.query(`INSERT INTO merchant_daily_volume (merchant_id, volume_date, refund_count, refund_gross_fils, last_updated_at)
+     SELECT merchant_id, (occurred_at AT TIME ZONE 'Asia/Bahrain')::date, COUNT(*), SUM(amount_fils), now() FROM refunds WHERE status = 'succeeded' GROUP BY 1, 2
+     ON CONFLICT (merchant_id, volume_date) DO UPDATE SET refund_count = EXCLUDED.refund_count, refund_gross_fils = EXCLUDED.refund_gross_fils`); // RBD-1: FP-300 refunds
+  await client.query(`INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id, updated_at)
+     SELECT 'reporting', COALESCE((SELECT id FROM outbox_events WHERE txid < pg_snapshot_xmin(pg_current_snapshot()) ORDER BY txid DESC, id DESC LIMIT 1), 0), now()
+     ON CONFLICT (consumer_name) DO UPDATE SET last_processed_id = EXCLUDED.last_processed_id, updated_at = now()`); // RBD-1: the worker resumes after what was rebuilt
+  const volumeRows = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM merchant_daily_volume`);
+  return { volumeRows: volumeRows.rows[0]!.n, trendRows: trendResult.rowCount ?? 0 };
```
Everything runs in the route's one transaction, in this order:
1. *Pause the worker.* `LOCK TABLE reporting_outbox_cursor IN EXCLUSIVE MODE` waits for a running pass to commit and blocks new passes, since every pass starts by locking its cursor row. The cursor is locked first, the same lock order as a pass and as the CLI rebuild (OBX-DOUBLE), so the `TRUNCATE`s cannot deadlock with a pass.
2. *One snapshot.* `REPEATABLE READ`, set before any query, gives the source tables, the refund aggregate and the watermark the same view of the data.
3. *The watermark the rebuild covered.* It is the worker's own rule (OBX-SKIP): the last outbox row, in `(txid, id)` order, below the snapshot's xmin. Every row up to it is in the snapshot, so it is in the rebuild; the worker resumes after it.
4. *The one exact-case guard.* If a reporting event is already visible but sits after that watermark (its transaction committed while an older one was still in flight), no single watermark can describe the snapshot. The rebuild then rolls back with 409 `reporting_rebuild_busy` and nothing changes. The operator presses again; on a quiet box this does not occur.
5. *Refunds.* Succeeded refunds are aggregated per merchant and Bahrain day, the same bucket the worker uses (the refund row and its `refund.succeeded` event share the transaction time). The cursor is upserted, so a worker that never ran also starts after the rebuild.

`volumeRows` is now the table's final row count (the documented meaning, `apps/admin/src/types.ts:240-241`), because refund-only days add rows. The `{ volumeRows, trendRows }` shape and the synchronous behaviour are unchanged.

**Why this is the smallest correct fix:** it keeps the button's synchronous contract and its source-table rebuild, and adds only the three things whose absence causes the damage: worker exclusion, the covered watermark and the refund columns. *Why not reset the cursor to 0 and let the worker replay (the lead's option)?* The response would become "0 rows" and asynchronous, contradicting the UI ("Rebuilt N rows") and ADMIN.md ("instead of waiting for the worker"). *Why not set the watermark to the newest outbox row?* A transaction in flight at the snapshot whose xid is older would commit a row behind it, and the worker would skip that row forever. *Why not take the watermark below xmin and accept the straddling rows?* Those rows are counted by the rebuild and again by the worker. The 409 guard is the only exact choice.

**Proof:** `RBD-1: rebuild, then one worker pass, leaves the rollups unchanged and the refund columns intact` (`apps/api/src/admin/reportingRebuild.audit.test.ts`; it imports the worker's `runConsumerPass` and retries a 409 caused by other databases' transactions on the shared test cluster).
- Before the fix: after the rebuild `refund_count: 0, refunds: 0` (expected 1 / 1,500).
- With only the refund aggregate and no watermark move: after the worker pass `captured_count: 2, gross: 20000, refund_count: 2, refunds: 3000`.
- After the fix: `{captured_count 1, gross 10,000, voided 0, refund_count 1, refunds 1,500}` both after the rebuild and after the worker pass.
- `routes/admin.test.ts`, `routes/analytics.test.ts` (55/55) and the reporting suite (17/17) pass.

**Regression risk:** The button can now answer 409 under concurrent payment traffic (snapshot xmin is cluster-wide, so a long-running write transaction anywhere delays it); it then changes nothing. The worker is paused for the rebuild's duration, as it was effectively blocked by the `TRUNCATE` locks before. The rebuild still counts by source tables (e.g. seeded history without outbox rows), which is unchanged; the worker continues to apply only later events.

Lines: prod +14/-1 (1 import, 1 comment line, 12 code lines), test +81/-0 (new file)
