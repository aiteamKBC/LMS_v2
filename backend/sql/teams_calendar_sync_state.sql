-- Durable identities used to recognize cancelled recurring instances safely.
-- No changes to existing schedules, attendance, invitations or meeting options.
CREATE TABLE IF NOT EXISTS curriculum.teams_calendar_sync_state (
    live_session_id varchar(128) PRIMARY KEY REFERENCES curriculum.live_sessions(id) ON DELETE CASCADE,
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    checked_at timestamptz NOT NULL DEFAULT current_timestamp
);
