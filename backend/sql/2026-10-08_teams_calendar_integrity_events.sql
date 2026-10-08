-- Teams Calendar integrity log
-- ----------------------------------------------------------------------------
-- Purpose
--   One row per integrity-relevant event on a module's Teams calendar: a save
--   that found a session missing from the recurring series, a status check, an
--   explicit Calendar health resolution, a session marked Completed by the
--   attendance sync, and a Teams run that was NOT used to complete a session
--   because it ended before the session was due.
--
--   Each row says who started it (origin + initiated_by_*), what executed it
--   (always the LMS service account for Microsoft writes), the trigger, the job
--   or correlation id, and the meeting reference before and after.
--
-- What it does NOT do
--   * No existing table is altered. No existing row is read, rewritten or
--     backfilled. Historical events are NOT reconstructed: a meeting created
--     before this table existed is shown as "System -- original trigger unknown".
--   * Join links are never stored. meeting_before / meeting_after hold the
--     Microsoft event id, the online meeting id and a 16-character SHA-256 digest
--     of the join link ("joinRef"), so two references compare equal without the
--     log becoming a way into a meeting.
--
-- Deployment order
--   1. Apply this file (manually, reviewed). It is idempotent (IF NOT EXISTS).
--   2. Deploy the backend. Until step 1 is applied the backend runs normally:
--      every write to this log is skipped with a server warning, and Calendar
--      health reports "audit log unavailable". No save fails for want of it.
--   3. Deploy the frontend.
--
-- Rollback
--   The backend tolerates the table's absence, so rolling back code needs no SQL.
--   To remove the log entirely (this deletes its history):
--     DROP TABLE IF EXISTS curriculum.teams_calendar_integrity_events;
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curriculum.teams_calendar_integrity_events (
    id                   varchar(64)  PRIMARY KEY,
    -- Not a foreign key on purpose: the log must outlive an archived series and
    -- must never block a delete elsewhere.
    live_session_id      varchar(128) NOT NULL,
    module_catalogue_id  varchar(128) NOT NULL DEFAULT '',
    session_number       integer,
    event_type           varchar(64)  NOT NULL,
    -- manual_user | user_initiated_background | scheduled_automation |
    -- backend_system | unknown_historical
    origin               varchar(40)  NOT NULL,
    initiated_by_email   varchar(320) NOT NULL DEFAULT '',
    initiated_by_name    varchar(500) NOT NULL DEFAULT '',
    executed_by          varchar(120) NOT NULL DEFAULT 'LMS service account',
    trigger              varchar(200) NOT NULL DEFAULT '',
    job_id               varchar(128) NOT NULL DEFAULT '',
    correlation_id       varchar(64)  NOT NULL DEFAULT '',
    meeting_before       jsonb        NOT NULL DEFAULT '{}'::jsonb,
    meeting_after        jsonb        NOT NULL DEFAULT '{}'::jsonb,
    -- success | attention | ignored | failed | unknown
    outcome              varchar(32)  NOT NULL DEFAULT 'success',
    detail               jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz  NOT NULL DEFAULT current_timestamp,
    CONSTRAINT teams_calendar_integrity_events_origin_check CHECK (origin IN (
        'manual_user', 'user_initiated_background', 'scheduled_automation', 'backend_system', 'unknown_historical'))
);

-- Calendar health reads one calendar's events newest first.
CREATE INDEX IF NOT EXISTS teams_calendar_integrity_events_series_idx
    ON curriculum.teams_calendar_integrity_events (live_session_id, created_at DESC);

-- Verification (read-only):
--   SELECT to_regclass('curriculum.teams_calendar_integrity_events');
--   SELECT count(*) FROM curriculum.teams_calendar_integrity_events;   -- 0 right after applying
 