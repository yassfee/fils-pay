### HUNT-3 · Dashboard payout trends show a paid payout as "closed" with no paid date, forever · · Severity: Medium

**What's wrong:** `GET /v1/analytics/payout-trends`, which the dashboard overview renders as a payouts table with a status and a "paid" column (`apps/web/src/pages/overview/OverviewPage.tsx:164,168`), reports every batch that was paid after its close event as `status: "closed"`, `paidAt: null`. In the normal flow (close at the end of the Bahrain day, pay later) that is every batch.

**Why it happens:** the reporting consumer writes `merchant_payout_trends` once, in `applyBatchClosed` (`apps/reporting/src/consumer/applyEvent.ts:83-118`), copying `settlement_batches.status` and `paid_at` as they are when it processes `settlement.batch_closed`. At that moment the batch is `closed`. `MarkBatchPaid` (`apps/settlement/internal/settlement/batch.go:366`) later sets `status = 'paid', paid_at = now()`, and the daemon enqueues a `settlement.paid` outbox event for it (`payout_notify.go`, aggregate id = batch id). But the consumer selects only `REPORTING_EVENT_TYPES` (`runConsumerPass.ts:8-13`), which did not include `settlement.paid`, so nothing ever refreshed the row. `getPayoutTrends` (`apps/api/src/analytics/query.ts:176-195`) reads only that row.

**What it breaks:** merchants see their payouts as not yet paid, with no paid date, after the money has gone out; support gets "where is my payout?" tickets the data cannot answer. Only a full `reporting rebuild` (which re-reads the live batch) corrects it, until the next batch.

**Why it needed a fix:** the payouts widget is the merchant's view of settlement; showing a paid payout as unpaid is wrong data on a money screen.

**Fix:** `apps/reporting/src/consumer/runConsumerPass.ts:13` and `applyEvent.ts:202-204`
```diff
   "refund.succeeded", // FP-300: refunds roll into merchant_daily_volume (applyDailySummaryRollup)
+  "settlement.paid", // HUNT-3: the batch is paid after its close event; refresh the payout-trend status
 ];
@@
+    case "settlement.paid": // HUNT-3: copy the live status/paid_at; batch_closed only saw the batch as 'closed'
+      await client.query(`UPDATE merchant_payout_trends t SET status = sb.status, paid_at = sb.paid_at, last_updated_at = now() FROM settlement_batches sb WHERE sb.id = t.settlement_batch_id AND sb.id = $1`, [row.aggregate_id]);
+      return;
```
The consumer now reads the event that already exists for exactly this transition and copies the batch's live status and paid date into the trend row, the same source `applyBatchClosed` uses.

**Why this is the smallest correct fix:** it reuses the existing event and the existing source of truth, inside the read model the widget is designed around (`live: false`, `readModelAsOf`). *Why not join `settlement_batches` in `getPayoutTrends`?* That bypasses the documented lagged read model for one widget and changes an API query path. *Why not add a new outbox event in Go?* `settlement.paid` already carries the batch id. The `UPDATE` is idempotent, so a replay (`cli/rebuild.ts`) or a duplicate event is harmless; if the paid event is applied before the close event, it matches no row and `applyBatchClosed` later copies the live `paid` status itself.

**Proof:** `HUNT-3: a batch paid after its close event shows as paid, with its paid date, in payout trends` (`apps/reporting/src/consumer/payoutTrendPaid.audit.test.ts`). Before: `the consumer must read settlement.paid events` (and the row stayed `closed`). After: passes; the row shows `paid` with the batch's `paid_at`.

**Regression risk:** the reporting suite passes (17/17), including `cli/rebuild.test.ts` (rollups after a rebuild match incremental processing), and `routes/analytics.test.ts` passes (13/13). Residual gaps, not changed: the daemon enqueues `settlement.paid` only for batches with `net_payout_fils > 0` (`payout_notify.go`), so a zero-net batch still shows `closed`; and rows already stale before this deploy need one `reporting rebuild`, because the cursor has already passed their `settlement.paid` events.

Lines: prod +4/-0, test +45/-0
