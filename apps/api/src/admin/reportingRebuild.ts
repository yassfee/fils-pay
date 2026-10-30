import type { PoolClient } from "pg";
import { ConflictError } from "../lib/errors.js";

/** Counts of outbox_events replayed into each rollup table. */
export interface RebuildAnalyticsSummary {
  volumeRows: number;
  trendRows: number;
}

/** Truncates and repopulates the two rollup tables
 *  (merchant_daily_volume, merchant_payout_trends) from source. */
export async function refreshAnalyticsRollups(client: PoolClient): Promise<RebuildAnalyticsSummary> {
  // RBD-1: one snapshot for the rebuild and the outbox watermark it covers; the reporting worker waits on its cursor.
  await client.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
  await client.query(`LOCK TABLE reporting_outbox_cursor IN EXCLUSIVE MODE`);
  const straddling = await client.query(`SELECT 1 FROM outbox_events WHERE txid >= pg_snapshot_xmin(pg_current_snapshot()) AND event_type IN ('transaction.captured', 'transaction.voided', 'settlement.batch_closed', 'refund.succeeded') LIMIT 1`);
  if (straddling.rows.length > 0) throw new ConflictError("reporting_rebuild_busy", "payments are committing out of order right now; retry in a moment");
  // YA: ACCESS EXCLUSIVE lock is fine while analytics is internal only (Jan 2026)
  await client.query(`TRUNCATE merchant_daily_volume`);
  await client.query(`TRUNCATE merchant_payout_trends`);

  const trendResult = await client.query(
    `INSERT INTO merchant_payout_trends
        (merchant_id, settlement_batch_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at, last_updated_at)
     SELECT merchant_id, id, batch_date, status, gross_fils, fee_fils, net_payout_fils, paid_at, now()
       FROM settlement_batches`,
  );

  const volumeResult = await client.query(
    `INSERT INTO merchant_daily_volume
        (merchant_id, volume_date, captured_count, captured_gross_fils, voided_count, last_updated_at)
     SELECT t.merchant_id,
            (te.occurred_at AT TIME ZONE 'Asia/Bahrain')::date,
            COUNT(*) FILTER (WHERE te.event_type IN ('captured', 'partially_captured')),
            COALESCE(SUM(te.amount_fils) FILTER (WHERE te.event_type IN ('captured', 'partially_captured')), 0),
            COUNT(*) FILTER (WHERE te.event_type = 'voided'),
            now()
       FROM transaction_events te
       JOIN transactions t ON t.id = te.transaction_id
      WHERE te.event_type IN ('captured', 'partially_captured', 'voided')
      GROUP BY t.merchant_id, (te.occurred_at AT TIME ZONE 'Asia/Bahrain')::date`,
  );

  await client.query(`INSERT INTO merchant_daily_volume (merchant_id, volume_date, refund_count, refund_gross_fils, last_updated_at)
     SELECT merchant_id, (occurred_at AT TIME ZONE 'Asia/Bahrain')::date, COUNT(*), SUM(amount_fils), now() FROM refunds WHERE status = 'succeeded' GROUP BY 1, 2
     ON CONFLICT (merchant_id, volume_date) DO UPDATE SET refund_count = EXCLUDED.refund_count, refund_gross_fils = EXCLUDED.refund_gross_fils`); // RBD-1: FP-300 refunds
  await client.query(`INSERT INTO reporting_outbox_cursor (consumer_name, last_processed_id, updated_at)
     SELECT 'reporting', COALESCE((SELECT id FROM outbox_events WHERE txid < pg_snapshot_xmin(pg_current_snapshot()) ORDER BY txid DESC, id DESC LIMIT 1), 0), now()
     ON CONFLICT (consumer_name) DO UPDATE SET last_processed_id = EXCLUDED.last_processed_id, updated_at = now()`); // RBD-1: the worker resumes after what was rebuilt
  const volumeRows = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM merchant_daily_volume`);
  return { volumeRows: volumeRows.rows[0]!.n, trendRows: trendResult.rowCount ?? 0 };
}
