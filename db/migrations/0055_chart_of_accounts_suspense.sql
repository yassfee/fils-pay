-- Additional suspense accounts for future reconciliation lanes.

INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  -- Captures rounding differences between fils and scheme-file BD amounts.
  ('fx_rounding_difference', 'FX Rounding Difference', 'asset'),
  -- Holds chargeback amounts pending acquirer confirmation.
  ('chargeback_suspense', 'Chargeback Suspense', 'asset')
ON CONFLICT (id) DO NOTHING;
