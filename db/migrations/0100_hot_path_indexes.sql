-- CAP-4: per-checkout lookups that scanned the whole table. The deferred balance trigger (0007) re-sums
-- entry_group_id for each of capture's 4 ledger rows at COMMIT; capture releases the hold by transaction_id.
CREATE INDEX IF NOT EXISTS ledger_entries_entry_group_id_idx ON ledger_entries (entry_group_id);
CREATE INDEX IF NOT EXISTS holds_transaction_id_idx ON holds (transaction_id);
