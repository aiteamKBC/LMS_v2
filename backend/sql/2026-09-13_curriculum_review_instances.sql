-- Curriculum becomes the provider of Review definitions; Coach becomes a
-- consumer. This adds:
--   * curriculum.review_templates.coach_surface -- which existing Coach page
--     (if any) an enabled template feeds. A Curriculum-side routing choice,
--     not a Coach-side name comparison: Coach queries by this stable code,
--     never by review_templates.name.
--   * curriculum.review_occurrence_overrides.learner_id -- a NULL value keeps
--     today's programme-wide skip; a set value scopes the skip to one
--     learner only, so a learner-specific clash/skip can no longer cancel
--     the same date for every learner on the programme.
--   * curriculum.review_instances / review_instance_answers /
--     review_instance_signatures -- the learner-specific occurrence, its
--     answers and its signatures. review_fields/review_sections stay the
--     QUESTION DEFINITION; instances/answers are the learner's RECORD.
--   * coach.coach_calendar_event.review_template_id / review_instance_id /
--     occurrence_number -- links an existing scheduled/booked calendar row
--     back to the Curriculum-driven review it belongs to, without
--     duplicating scheduling/Teams data Coach already owns.
--
-- Run against Neon directly -- see backend/sql conventions.
BEGIN;

ALTER TABLE curriculum.review_templates
    ADD COLUMN IF NOT EXISTS coach_surface varchar(32);

ALTER TABLE curriculum.review_templates
    DROP CONSTRAINT IF EXISTS review_templates_coach_surface_valid;

ALTER TABLE curriculum.review_templates
    ADD CONSTRAINT review_templates_coach_surface_valid CHECK (
        coach_surface IS NULL OR coach_surface IN ('mcr', 'progress_review')
    );

-- One enabled template per programme may claim a given Coach surface --
-- otherwise Coach would not know which template's recurrence/eligibility to
-- use for e.g. /coach/meetings on that programme.
CREATE UNIQUE INDEX IF NOT EXISTS review_templates_coach_surface_uniq
    ON curriculum.review_templates (programme_id, coach_surface)
    WHERE deleted_at IS NULL AND enabled = true AND coach_surface IS NOT NULL;

ALTER TABLE curriculum.review_occurrence_overrides
    ADD COLUMN IF NOT EXISTS learner_id integer;

CREATE TABLE IF NOT EXISTS curriculum.review_instances (
    id varchar(128) PRIMARY KEY,
    review_template_id varchar(128) NOT NULL,
    learner_id integer NOT NULL,
    learner_kind varchar(32) NOT NULL DEFAULT '',
    programme_id varchar(255) NOT NULL,
    occurrence_number integer NOT NULL,
    target_date date NOT NULL,
    coach_email varchar(255) NOT NULL DEFAULT '',
    calendar_event_id integer,
    -- Frozen copy of {template, sections, fields} at the moment this instance
    -- was first created, so a later Curriculum edit (a renamed/removed
    -- question, a changed signature rule) cannot silently change the
    -- meaning of an already-completed review. The live template is still
    -- used for the instance's *display title* (see review_instances.py) --
    -- only the QUESTION SET and per-instance rules are frozen here.
    definition_snapshot jsonb NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'not-scheduled',
    started_at timestamp,
    completed_at timestamp,
    created_by varchar(255) NOT NULL DEFAULT '',
    updated_by varchar(255) NOT NULL DEFAULT '',
    created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_at timestamp NOT NULL DEFAULT current_timestamp
);

-- Deterministic occurrence identity: repeated resolution/scheduling calls
-- must never create a duplicate instance for the same learner + template +
-- occurrence number.
CREATE UNIQUE INDEX IF NOT EXISTS review_instances_identity_uniq
    ON curriculum.review_instances (review_template_id, learner_id, occurrence_number);

CREATE INDEX IF NOT EXISTS review_instances_learner_idx
    ON curriculum.review_instances (learner_id, target_date);

CREATE INDEX IF NOT EXISTS review_instances_calendar_event_idx
    ON curriculum.review_instances (calendar_event_id);

CREATE TABLE IF NOT EXISTS curriculum.review_instance_answers (
    id varchar(128) PRIMARY KEY,
    review_instance_id varchar(128) NOT NULL,
    field_id varchar(128) NOT NULL,
    answer jsonb,
    answered_by varchar(255) NOT NULL DEFAULT '',
    answered_at timestamp NOT NULL DEFAULT current_timestamp,
    created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_at timestamp NOT NULL DEFAULT current_timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS review_instance_answers_uniq
    ON curriculum.review_instance_answers (review_instance_id, field_id);

CREATE TABLE IF NOT EXISTS curriculum.review_instance_signatures (
    id varchar(128) PRIMARY KEY,
    review_instance_id varchar(128) NOT NULL,
    role varchar(32) NOT NULL,
    signed_by varchar(255) NOT NULL DEFAULT '',
    signed_name varchar(255) NOT NULL DEFAULT '',
    signature text,
    signed_at timestamp,
    created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_at timestamp NOT NULL DEFAULT current_timestamp
);

ALTER TABLE curriculum.review_instance_signatures
    DROP CONSTRAINT IF EXISTS review_instance_signatures_role_valid;

ALTER TABLE curriculum.review_instance_signatures
    ADD CONSTRAINT review_instance_signatures_role_valid CHECK (
        role IN ('advisor', 'employer', 'participant', 'referrer')
    );

CREATE UNIQUE INDEX IF NOT EXISTS review_instance_signatures_uniq
    ON curriculum.review_instance_signatures (review_instance_id, role);

ALTER TABLE "Coach"."coach_calendar_event"
    ADD COLUMN IF NOT EXISTS review_template_id varchar(128);

ALTER TABLE "Coach"."coach_calendar_event"
    ADD COLUMN IF NOT EXISTS review_instance_id varchar(128);

ALTER TABLE "Coach"."coach_calendar_event"
    ADD COLUMN IF NOT EXISTS occurrence_number integer;

CREATE INDEX IF NOT EXISTS coach_calendar_event_review_instance_idx
    ON "Coach"."coach_calendar_event" (review_instance_id);

COMMIT;
