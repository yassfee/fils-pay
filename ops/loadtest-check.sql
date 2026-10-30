-- Money correctness after an ops/loadtest.mjs run. Read-only. Every count in the second block must be 0.
-- Usage: docker compose -f ops/docker-compose.yml -f ops/docker-compose.prod.yml exec -T postgres \
--          psql -U filspay -d filspay -v tag=<run tag printed by loadtest.mjs> < ops/loadtest-check.sql
-- Links and transactions of the run carry reference '<tag>-<step>-<n>'. MODE=api runs create no links, so the
-- link-based counts read 0 for them. Joins, not per-row subqueries: one pass over each table.
\pset footer off
WITH l AS (SELECT * FROM payment_links WHERE reference LIKE :'tag' || '-%'),
     t AS (SELECT * FROM transactions WHERE reference LIKE :'tag' || '-%')
SELECT (SELECT count(*) FROM l) AS links,
       (SELECT count(*) FROM l WHERE status = 'paid') AS links_paid,
       (SELECT count(*) FROM l WHERE status = 'reserved') AS links_reserved,
       (SELECT count(*) FROM t) AS transactions,
       (SELECT count(*) FROM t WHERE status = 'captured') AS captured,
       (SELECT count(*) FROM t WHERE status = 'authorized') AS authorized_only,
       (SELECT count(*) FROM outbox_events o JOIN t ON t.id = o.aggregate_id WHERE o.id > (SELECT coalesce(max(last_processed_id), 0)
          FROM reporting_outbox_cursor WHERE consumer_name = 'reporting')) AS outbox_not_yet_reported;

WITH l AS (SELECT * FROM payment_links WHERE reference LIKE :'tag' || '-%'),
     t AS (SELECT * FROM transactions WHERE reference LIKE :'tag' || '-%'),
     g AS (SELECT e.transaction_id,
                  count(*) FILTER (WHERE e.description = 'capture: gross') AS gross_n,
                  coalesce(sum(e.amount_fils) FILTER (WHERE e.description = 'capture: gross'), 0) AS gross_sum,
                  sum(CASE e.direction WHEN 'debit' THEN e.amount_fils ELSE -e.amount_fils END) AS net
             FROM ledger_entries e JOIN t ON t.id = e.transaction_id GROUP BY e.transaction_id),
     o AS (SELECT o.aggregate_id, count(*) AS n FROM outbox_events o JOIN t ON t.id = o.aggregate_id
            WHERE o.event_type = 'transaction.captured' GROUP BY o.aggregate_id)
SELECT
  -- double charge: one link (reference) with more than one captured transaction
  (SELECT count(*) FROM (SELECT reference FROM t WHERE status = 'captured' GROUP BY reference HAVING count(*) > 1) x) AS double_captured,
  -- lost capture: a paid link whose transaction is not captured for the link amount
  (SELECT count(*) FROM l LEFT JOIN transactions tx ON tx.id = l.transaction_id
    WHERE l.status = 'paid' AND (tx.id IS NULL OR tx.status <> 'captured' OR tx.captured_fils <> l.amount_fils)) AS paid_not_captured,
  -- captured money on a link that is not paid (still payable: CAP-6); payment-link runs only
  (SELECT count(*) FROM t LEFT JOIN l ON l.transaction_id = t.id AND l.status = 'paid'
    WHERE t.status = 'captured' AND l.id IS NULL AND EXISTS (SELECT 1 FROM l)) AS captured_link_unpaid,
  -- ledger: exactly one gross pair per captured transaction, for the captured amount
  (SELECT count(*) FROM t LEFT JOIN g ON g.transaction_id = t.id
    WHERE t.status = 'captured' AND (g.gross_n IS DISTINCT FROM 2 OR g.gross_sum IS DISTINCT FROM 2 * t.captured_fils)) AS gross_legs_wrong,
  -- ledger: debits = credits per transaction
  (SELECT count(*) FROM g WHERE g.net <> 0) AS unbalanced_txns,
  -- no ledger legs for money that was never captured
  (SELECT count(*) FROM t JOIN g ON g.transaction_id = t.id WHERE t.status = 'authorized') AS legs_on_uncaptured,
  -- outbox: exactly one transaction.captured event per captured transaction
  (SELECT count(*) FROM t LEFT JOIN o ON o.aggregate_id = t.id WHERE t.status = 'captured' AND o.n IS DISTINCT FROM 1) AS outbox_captured_not_one;
