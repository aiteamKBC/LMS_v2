-- Locks the shared Monthly Logs record after both learner and coach sign.
-- Unlocking never removes or replaces a signature; it only permits an
-- administrator to reopen the record for a controlled correction.
BEGIN;
CREATE TABLE IF NOT EXISTS "Audit".monthly_log_locks (
    learner_id varchar(128) NOT NULL,
    report_month varchar(7) NOT NULL,
    locked_at timestamptz NOT NULL DEFAULT now(),
    unlocked_at timestamptz,
    unlocked_by varchar(128),
    PRIMARY KEY (learner_id, report_month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_log_locks_active
    ON "Audit".monthly_log_locks (learner_id, report_month)
    WHERE unlocked_at IS NULL;
COMMIT;
