-- Records when periodic maintenance last completed, so a maintenance job can decide whether
-- it is due. Key-value rather than a dedicated column per job: the second job added here
-- would otherwise need its own migration, and the table is never queried relationally.
--
-- `last_run_at` is an epoch SECONDS timestamp (matching the existing *_at columns, which use
-- millis; see db::maintenance for why seconds are enough here and what converts them).
CREATE TABLE maintenance_log (
    task VARCHAR(64) PRIMARY KEY NOT NULL,
    last_run_at BIGINT NOT NULL,
    run_count BIGINT NOT NULL DEFAULT 0
);
