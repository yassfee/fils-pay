-- C5: admin_audit_log is append-only (0034: "every privileged admin action leaves exactly one row").
-- The one legitimate UPDATE is markAdminAuditOutcome (apps/api/src/adminAudit/log.ts:112): it sets
-- outcome and merges new keys into metadata. Every other column is frozen, existing metadata cannot be
-- rewritten and rows cannot be deleted. (TRUNCATE, used by the dev seed, is not a row operation.)
CREATE FUNCTION reject_admin_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.metadata @> OLD.metadata
       AND (NEW.id, NEW.admin_user_id, NEW.action, NEW.target_type, NEW.target_id, NEW.created_at)
           IS NOT DISTINCT FROM (OLD.id, OLD.admin_user_id, OLD.action, OLD.target_type, OLD.target_id, OLD.created_at) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'admin_audit_log is append-only: % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_append_only BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_mutation();
