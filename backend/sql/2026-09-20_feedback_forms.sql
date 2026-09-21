-- Run manually in the Neon SQL Editor. This project does not use migrations
-- for externally managed schemas. Safe to re-run: all objects are IF NOT EXISTS.
CREATE SCHEMA IF NOT EXISTS "Feedback";

CREATE TABLE IF NOT EXISTS "Feedback".feedback_forms (
    id bigserial PRIMARY KEY,
    title varchar(255) NOT NULL,
    description text NOT NULL DEFAULT '',
    instructions text NOT NULL DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','closed')),
    start_date timestamptz NULL,
    due_date timestamptz NULL,
    anonymous_responses boolean NOT NULL DEFAULT false,
    allow_save_continue boolean NOT NULL DEFAULT true,
    allow_edit_after_submission boolean NOT NULL DEFAULT false,
    created_by varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_form_sections (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE CASCADE,
    title varchar(255) NOT NULL,
    description text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_questions (
    id bigserial PRIMARY KEY,
    section_id bigint NOT NULL REFERENCES "Feedback".feedback_form_sections(id) ON DELETE CASCADE,
    question_type varchar(30) NOT NULL CHECK (question_type IN ('short_text','long_text','yes_no','single_choice','multiple_choice','dropdown','rating','likert','number','date')),
    question_text text NOT NULL,
    required boolean NOT NULL DEFAULT false,
    help_text text NOT NULL DEFAULT '',
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_assignments (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE CASCADE,
    target_type varchar(30) NOT NULL,
    target_id varchar(100) NULL,
    assigned_by varchar(255) NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    due_date timestamptz NULL,
    CONSTRAINT feedback_assignment_target CHECK (
      (target_type = 'all_learners' AND target_id IS NULL) OR
      (target_type <> 'all_learners' AND target_id IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_assignment_unique_target
  ON "Feedback".feedback_assignments (form_id, target_type, COALESCE(target_id, ''));

CREATE TABLE IF NOT EXISTS "Feedback".feedback_responses (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL,
    programme varchar(255) NOT NULL DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz NULL,
    UNIQUE (form_id, learner_id)
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_answers (
    id bigserial PRIMARY KEY,
    response_id bigint NOT NULL REFERENCES "Feedback".feedback_responses(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
    answer jsonb NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (response_id, question_id)
);

CREATE INDEX IF NOT EXISTS feedback_sections_form_order ON "Feedback".feedback_form_sections (form_id, sort_order);
CREATE INDEX IF NOT EXISTS feedback_questions_section_order ON "Feedback".feedback_questions (section_id, sort_order);
CREATE INDEX IF NOT EXISTS feedback_responses_form_status ON "Feedback".feedback_responses (form_id, status);
CREATE INDEX IF NOT EXISTS feedback_assignments_target ON "Feedback".feedback_assignments (target_type, target_id);
