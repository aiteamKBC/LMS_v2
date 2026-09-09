-- Stores Microsoft Teams coach-meeting artifacts and attendance snapshots.
-- Run manually in Neon SQL Editor. This is intentionally not a Django migration.

CREATE SCHEMA IF NOT EXISTS "Coach";

CREATE TABLE IF NOT EXISTS "Coach".coach_meeting_artifacts (
    id bigserial PRIMARY KEY,
    calendar_event_id bigint REFERENCES "Coach".coach_calendar_event(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    owner_email text NOT NULL,
    graph_organizer_email text NOT NULL DEFAULT '',
    graph_event_id text NOT NULL DEFAULT '',
    artifact_type varchar(32) NOT NULL,
    graph_artifact_id text NOT NULL,
    call_id text NOT NULL DEFAULT '',
    content_correlation_id text NOT NULL DEFAULT '',
    created_datetime timestamptz,
    end_datetime timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coach_meeting_artifact_type_valid
        CHECK (artifact_type IN ('transcript', 'recording'))
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_meeting_artifacts_event_artifact_uniq
    ON "Coach".coach_meeting_artifacts (event_key, artifact_type, graph_artifact_id);

CREATE INDEX IF NOT EXISTS coach_meeting_artifacts_owner_event_idx
    ON "Coach".coach_meeting_artifacts (owner_email, event_key);


CREATE TABLE IF NOT EXISTS "Coach".coach_meeting_attendance_reports (
    id bigserial PRIMARY KEY,
    calendar_event_id bigint REFERENCES "Coach".coach_calendar_event(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    owner_email text NOT NULL,
    graph_organizer_email text NOT NULL DEFAULT '',
    graph_event_id text NOT NULL DEFAULT '',
    graph_report_id text NOT NULL,
    meeting_start_datetime timestamptz,
    meeting_end_datetime timestamptz,
    total_participant_count integer NOT NULL DEFAULT 0,
    attended_count integer NOT NULL DEFAULT 0,
    absent_count integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_meeting_attendance_reports_event_report_uniq
    ON "Coach".coach_meeting_attendance_reports (event_key, graph_report_id);

CREATE INDEX IF NOT EXISTS coach_meeting_attendance_reports_owner_event_idx
    ON "Coach".coach_meeting_attendance_reports (owner_email, event_key);


CREATE TABLE IF NOT EXISTS "Coach".coach_meeting_attendance (
    id bigserial PRIMARY KEY,
    calendar_event_id bigint REFERENCES "Coach".coach_calendar_event(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    participant_key text NOT NULL,
    owner_email text NOT NULL,
    graph_organizer_email text NOT NULL DEFAULT '',
    graph_event_id text NOT NULL DEFAULT '',
    event_type varchar(32) NOT NULL DEFAULT '',
    learner_id bigint,
    learner_name text NOT NULL DEFAULT '',
    learner_email text NOT NULL DEFAULT '',
    role varchar(32) NOT NULL DEFAULT 'attendee',
    display_name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    expected boolean NOT NULL DEFAULT false,
    required boolean NOT NULL DEFAULT false,
    attended boolean NOT NULL DEFAULT false,
    status varchar(24) NOT NULL DEFAULT 'pending',
    total_attendance_seconds integer NOT NULL DEFAULT 0,
    actual_display_name text NOT NULL DEFAULT '',
    actual_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    report_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_current boolean NOT NULL DEFAULT true,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT coach_meeting_attendance_status_valid
        CHECK (status IN ('attended', 'absent', 'pending', 'extra')),
    CONSTRAINT coach_meeting_attendance_seconds_non_negative
        CHECK (total_attendance_seconds >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_meeting_attendance_event_participant_uniq
    ON "Coach".coach_meeting_attendance (event_key, participant_key);

CREATE INDEX IF NOT EXISTS coach_meeting_attendance_owner_event_idx
    ON "Coach".coach_meeting_attendance (owner_email, event_key, is_current);

CREATE INDEX IF NOT EXISTS coach_meeting_attendance_learner_idx
    ON "Coach".coach_meeting_attendance (learner_id, event_type, status)
    WHERE is_current;

CREATE INDEX IF NOT EXISTS coach_meeting_attendance_status_idx
    ON "Coach".coach_meeting_attendance (status, expected)
    WHERE is_current;
