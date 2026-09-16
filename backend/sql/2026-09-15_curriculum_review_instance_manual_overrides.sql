-- Persists ONLY the authorised manual "scheduled -> in-progress" override for
-- a linked Curriculum-backed review instance (see
-- curriculum_api.review_instances.mark_review_instance_in_progress_manually).
-- This is the exception path -- real Microsoft Teams attendance
-- (mark_review_instance_in_progress_from_attendance) remains the normal one
-- and never writes here. Nothing else (scheduling, drafting, completion,
-- signatures, cancellation) is recorded in this table.
--
-- Append-only: one row per manual override, inserted in the same
-- transaction as the review_instances status UPDATE it records, and only
-- when that transition actually succeeds.
--
-- Run against Neon directly -- see backend/sql conventions.
BEGIN;

CREATE TABLE IF NOT EXISTS curriculum.review_instance_manual_overrides (
    id varchar(128) PRIMARY KEY,
    review_instance_id varchar(128) NOT NULL,
    calendar_event_id integer,
    previous_status varchar(32) NOT NULL,
    new_status varchar(32) NOT NULL,
    reason_code varchar(64) NOT NULL,
    note text NOT NULL DEFAULT '',
    changed_by varchar(255) NOT NULL,
    changed_at timestamp NOT NULL DEFAULT current_timestamp,
    -- The actual meeting start time the Coach specified, or the same
    -- effective started_at value written to review_instances.started_at
    -- when they did not -- never Teams attendance evidence.
    manual_started_at timestamp
);

CREATE INDEX IF NOT EXISTS review_instance_manual_overrides_instance_idx
    ON curriculum.review_instance_manual_overrides (review_instance_id, changed_at DESC);

COMMIT;
