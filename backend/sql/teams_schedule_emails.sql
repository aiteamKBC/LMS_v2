-- Owner-run in Neon SQL Editor only. No runtime provisioning or migrations.
-- One ordinary schedule-summary email per live calendar and recipient.
-- This creates a delivery ledger; it does not send messages or modify meetings.
CREATE TABLE IF NOT EXISTS curriculum.teams_schedule_emails (
    live_session_id varchar(128) NOT NULL,
    recipient text NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'accepted', 'failed', 'unknown')),
    attempt_count integer NOT NULL DEFAULT 0,
    error_code varchar(80) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (live_session_id, recipient),
    CHECK (recipient = lower(btrim(recipient)))
);

-- Read-only verification (run separately after creation).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'curriculum' AND table_name = 'teams_schedule_emails'
ORDER BY ordinal_position;

SELECT status, count(*) FROM curriculum.teams_schedule_emails GROUP BY status;
