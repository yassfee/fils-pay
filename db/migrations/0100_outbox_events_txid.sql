-- OBX-SKIP: ids are taken at INSERT, commits land in any order, so an id watermark skips late commits.
-- Each row records its inserting transaction; consumers order by (txid, id) and read only txid below the
-- snapshot xmin (finished transactions). Existing rows all get this migration's txid, so id order is kept.
ALTER TABLE outbox_events ADD COLUMN txid xid8 NOT NULL DEFAULT pg_current_xact_id();
CREATE INDEX idx_outbox_events_txid_id ON outbox_events (txid, id);
