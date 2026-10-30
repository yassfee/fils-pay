-- LED-1 (F2): the ledger is append-only. 0007's balance trigger only rejects an UNBALANCED change, so
-- scaling or back-dating a whole group, or deleting it, stayed balanced and committed. Corrections are
-- compensating groups. (TRUNCATE, used by the dev seed, is not a row operation and is unaffected.)
CREATE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries is append-only: post a compensating entry instead of %', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
