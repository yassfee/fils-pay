-- VOL-1: money is integer fils in BIGINT (case file; ADR-0001). INTEGER wraps
-- at 2,147,483,647 fils, just past the 2,000,000,000 fils volume-tier threshold.
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
