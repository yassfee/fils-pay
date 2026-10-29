-- EST-1 (G2): money is integer fils (case file; ADR-0001). The REAL running
-- total (0040) was bumped through float32 and drifts above 2^24 fils.
ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING round(lifetime_net_payout_monitoring_estimate)::bigint;
