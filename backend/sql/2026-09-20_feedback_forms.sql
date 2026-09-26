-- Run manually in the Neon SQL Editor. This project does not use migrations
-- for externally managed schemas. Safe to re-run: all objects are IF NOT EXISTS.
CREATE SCHEMA IF NOT EXISTS "Feedback";

CREATE TABLE IF NOT EXISTS "Feedback".feedback_forms (
    id bigserial PRIMARY KEY,
    title varchar(255) NOT NULL,
    form_type varchar(40) NOT NULL DEFAULT 'general' CHECK (form_type IN ('general','post_lecture')),
    delivery_scope varchar(20) NOT NULL DEFAULT 'manual' CHECK (delivery_scope IN ('manual','all_modules','module')),
    template_key uuid NOT NULL DEFAULT gen_random_uuid(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    is_current boolean NOT NULL DEFAULT true,
    previous_version_id bigint NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    description text NOT NULL DEFAULT '',
    instructions text NOT NULL DEFAULT '',
    programme_id varchar(255) NOT NULL DEFAULT '',
    programme_name varchar(255) NOT NULL DEFAULT '',
    cohort_id varchar(255) NOT NULL DEFAULT '',
    cohort_name varchar(255) NOT NULL DEFAULT '',
    group_id varchar(255) NOT NULL DEFAULT '',
    group_name varchar(255) NOT NULL DEFAULT '',
    module_catalogue_id varchar(255) NOT NULL DEFAULT '',
    module_name varchar(255) NOT NULL DEFAULT '',
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

-- Upgrade an existing Feedback schema. The IDs are intentionally not cross-
-- schema foreign keys: curriculum records can be archived, while historical
-- feedback forms and their display names must remain readable.
ALTER TABLE "Feedback".feedback_forms
  ADD COLUMN IF NOT EXISTS form_type varchar(40) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS delivery_scope varchar(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS template_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS previous_version_id bigint NULL,
  ADD COLUMN IF NOT EXISTS programme_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS programme_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cohort_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cohort_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS module_catalogue_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS module_name varchar(255) NOT NULL DEFAULT '';

UPDATE "Feedback".feedback_forms
SET delivery_scope = CASE
  WHEN form_type = 'post_lecture' AND module_catalogue_id <> '' THEN 'module'
  WHEN form_type = 'post_lecture' THEN 'all_modules'
  ELSE 'manual'
END
WHERE delivery_scope = 'manual' AND form_type = 'post_lecture';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_form_type_check'
      AND conrelid = '"Feedback".feedback_forms'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_forms
      ADD CONSTRAINT feedback_form_type_check
      CHECK (form_type IN ('general','post_lecture'));
  END IF;
END $$;

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
    question_type varchar(30) NOT NULL CHECK (question_type IN ('short_text','long_text','yes_no','single_choice','multiple_choice','dropdown','rating','likert','number','date','name','email','photo_upload')),
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

-- A form is a reusable template. A delivery is one occurrence of that
-- template after one lecture; recipients are the finalized attendees.
CREATE TABLE IF NOT EXISTS "Feedback".feedback_deliveries (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    occurrence_key varchar(255) NOT NULL,
    attendance_source varchar(80) NOT NULL DEFAULT 'attendance',
    attendance_reference varchar(255) NOT NULL DEFAULT '',
    programme_id varchar(255) NOT NULL DEFAULT '',
    programme_name varchar(255) NOT NULL DEFAULT '',
    cohort_id varchar(255) NOT NULL DEFAULT '',
    cohort_name varchar(255) NOT NULL DEFAULT '',
    group_id varchar(255) NOT NULL DEFAULT '',
    group_name varchar(255) NOT NULL DEFAULT '',
    module_catalogue_id varchar(255) NOT NULL,
    module_name varchar(500) NOT NULL DEFAULT '',
    session_title varchar(500) NOT NULL DEFAULT '',
    starts_at timestamptz NULL,
    ends_at timestamptz NULL,
    available_at timestamptz NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (form_id, occurrence_key)
);

ALTER TABLE "Feedback".feedback_deliveries
  ADD COLUMN IF NOT EXISTS programme_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS programme_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cohort_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cohort_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_id varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS group_name varchar(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS module_name varchar(500) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "Feedback".feedback_delivery_recipients (
    id bigserial PRIMARY KEY,
    delivery_id bigint NOT NULL REFERENCES "Feedback".feedback_deliveries(id) ON DELETE CASCADE,
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL,
    programme varchar(255) NOT NULL DEFAULT '',
    attendance_reference varchar(255) NOT NULL DEFAULT '',
    assigned_at timestamptz NOT NULL DEFAULT now(),
    due_date timestamptz NULL,
    revoked_at timestamptz NULL,
    UNIQUE (delivery_id, learner_id)
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_responses (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    delivery_id bigint NULL,
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL,
    programme varchar(255) NOT NULL DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz NULL
);

ALTER TABLE "Feedback".feedback_responses
  ADD COLUMN IF NOT EXISTS delivery_id bigint NULL;

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'Feedback'
      AND t.relname = 'feedback_responses'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) LIKE '%(form_id, learner_id)%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_responses DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_response_delivery_fk'
      AND conrelid = '"Feedback".feedback_responses'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_responses
      ADD CONSTRAINT feedback_response_delivery_fk
      FOREIGN KEY (delivery_id) REFERENCES "Feedback".feedback_deliveries(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_delivery_scope_check'
      AND conrelid = '"Feedback".feedback_forms'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_forms
      ADD CONSTRAINT feedback_delivery_scope_check
      CHECK (delivery_scope IN ('manual','all_modules','module'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_form_version_check'
      AND conrelid = '"Feedback".feedback_forms'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_forms
      ADD CONSTRAINT feedback_form_version_check CHECK (version > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_form_previous_version_fk'
      AND conrelid = '"Feedback".feedback_forms'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_forms
      ADD CONSTRAINT feedback_form_previous_version_fk
      FOREIGN KEY (previous_version_id) REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_general
  ON "Feedback".feedback_responses (form_id, learner_id)
  WHERE delivery_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_delivery
  ON "Feedback".feedback_responses (delivery_id, learner_id)
  WHERE delivery_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS "Feedback".feedback_answers (
    id bigserial PRIMARY KEY,
    response_id bigint NOT NULL REFERENCES "Feedback".feedback_responses(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
    answer jsonb NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (response_id, question_id)
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id bigint NOT NULL REFERENCES "Feedback".feedback_responses(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
    blob_name text NOT NULL,
    original_name varchar(255) NOT NULL,
    content_type varchar(100) NOT NULL DEFAULT 'image/jpeg',
    size integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (response_id, question_id)
);

-- Upgrade an already-created Feedback schema with the new field types. The
-- original inline CHECK gets a PostgreSQL-generated name, so locate it by its
-- definition instead of assuming that name. Safe to run repeatedly.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'Feedback'
      AND t.relname = 'feedback_questions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%question_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_questions DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  ALTER TABLE "Feedback".feedback_questions
    ADD CONSTRAINT feedback_question_type_check
    CHECK (question_type IN ('short_text','long_text','yes_no','single_choice','multiple_choice','dropdown','rating','likert','number','date','name','email','photo_upload'));
END $$;

CREATE INDEX IF NOT EXISTS feedback_sections_form_order ON "Feedback".feedback_form_sections (form_id, sort_order);
CREATE INDEX IF NOT EXISTS feedback_questions_section_order ON "Feedback".feedback_questions (section_id, sort_order);
CREATE INDEX IF NOT EXISTS feedback_responses_form_status ON "Feedback".feedback_responses (form_id, status);
CREATE INDEX IF NOT EXISTS feedback_assignments_target ON "Feedback".feedback_assignments (target_type, target_id);
CREATE INDEX IF NOT EXISTS feedback_uploads_response ON "Feedback".feedback_uploads (response_id);
CREATE INDEX IF NOT EXISTS feedback_forms_module ON "Feedback".feedback_forms (module_catalogue_id, form_type);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_form_one_current_version
  ON "Feedback".feedback_forms (template_key) WHERE is_current;
CREATE INDEX IF NOT EXISTS feedback_forms_delivery_scope
  ON "Feedback".feedback_forms (form_type, delivery_scope, module_catalogue_id, status, is_current);
CREATE UNIQUE INDEX IF NOT EXISTS feedback_delivery_unique_occurrence
  ON "Feedback".feedback_deliveries (occurrence_key);
CREATE INDEX IF NOT EXISTS feedback_deliveries_module_occurrence ON "Feedback".feedback_deliveries (module_catalogue_id, occurrence_key);
CREATE INDEX IF NOT EXISTS feedback_delivery_recipients_learner ON "Feedback".feedback_delivery_recipients (learner_id, revoked_at);
CREATE INDEX IF NOT EXISTS feedback_responses_delivery_status ON "Feedback".feedback_responses (delivery_id, status);
