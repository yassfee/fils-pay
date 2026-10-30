import type { Pool } from "pg";
import { formatBhd, toFils } from "@filspay/money";

/**
 * Report predicate. The route passes a client `merchantId` through
 * resolveReportMerchantId: the caller's own id, or a split child whose parent
 * is the caller (RPT-SCOPE-1); anything else falls back to the caller.
 */
export interface TransactionReportFilter {
  merchantId: string;
  status?: string;
  from?: string;
  to?: string;
}

/** Money is pre-formatted as BD strings with 3 decimals (formatBhd), unlike the rest of the API which returns fils. */
export interface TransactionReportRow {
  id: string;
  merchantId: string;
  status: string;
  amountBhd: string;
  capturedBhd: string;
  reference: string | null;
  occurredAt: string;
}

interface TransactionReportQueryRow {
  id: string;
  merchant_id: string;
  status: string;
  amount_fils: string | number;
  captured_fils: string | number;
  reference: string | null;
  occurred_at: Date;
}

export async function runTransactionsReport(
  pool: Pool,
  filter: TransactionReportFilter,
): Promise<TransactionReportRow[]> {
  const params: unknown[] = [filter.merchantId];
  const conditions: string[] = ["merchant_id = $1"];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.from) {
    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.from) ? `${filter.from}T00:00:00+03:00` : filter.from); // DATE-1: a bare date is a Bahrain business day
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (filter.to) {
    params.push(/^\d{4}-\d{2}-\d{2}$/.test(filter.to) ? `${filter.to}T00:00:00+03:00` : filter.to);
    conditions.push(`occurred_at < $${params.length}`);
  }

  const result = await pool.query<TransactionReportQueryRow>(
    `SELECT id, merchant_id, status, amount_fils, captured_fils, reference, occurred_at
       FROM transactions
      WHERE ${conditions.join(" AND ")}
      ORDER BY occurred_at DESC
      LIMIT 500`,
    params,
  );
  return result.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchant_id,
    status: row.status,
    amountBhd: formatBhd(toFils(Number(row.amount_fils))),
    capturedBhd: formatBhd(toFils(Number(row.captured_fils))),
    reference: row.reference,
    occurredAt: row.occurred_at.toISOString(),
  }));
}
