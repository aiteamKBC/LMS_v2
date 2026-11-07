-- Manual equivalent of engagement_api.0010_employer_review_feedback.
-- Run the entire file on the intended LMS PostgreSQL database after verifying
-- the target and backup/restore point. No historical assignments are created.
-- Django can subsequently apply 0010 normally; do not fake its migration record.
BEGIN;
SET LOCAL statement_timeout = '30s';

SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "Feedback".feedback_employer_review_deliveries (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    source_review_id bigint NOT NULL UNIQUE,
    aptem_review_id text NOT NULL DEFAULT '',
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL DEFAULT '',
    review_type varchar(255) NOT NULL,
    review_name varchar(500) NOT NULL DEFAULT '',
    completed_at timestamptz NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    employer_id bigint NULL,
    employer_name varchar(255) NOT NULL DEFAULT '',
    employer_email text NOT NULL DEFAULT '',
    pending_reason varchar(80) NOT NULL DEFAULT 'missing_employer_link',
    CHECK ((employer_id IS NULL AND pending_reason <> '') OR (employer_id IS NOT NULL AND pending_reason = ''))
);
ALTER TABLE "Feedback".feedback_responses
    ADD COLUMN IF NOT EXISTS employer_review_delivery_id bigint NULL
    REFERENCES "Feedback".feedback_employer_review_deliveries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_employer_review
    ON "Feedback".feedback_responses (employer_review_delivery_id)
    WHERE employer_review_delivery_id IS NOT NULL;
DROP INDEX IF EXISTS "Feedback".feedback_response_unique_general;
CREATE UNIQUE INDEX feedback_response_unique_general
    ON "Feedback".feedback_responses (form_id, learner_id)
    WHERE delivery_id IS NULL AND event_recipient_id IS NULL AND rsvp_recipient_id IS NULL
      AND review_delivery_id IS NULL AND employer_review_delivery_id IS NULL;
CREATE INDEX IF NOT EXISTS feedback_employer_review_owner
    ON "Feedback".feedback_employer_review_deliveries (employer_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS feedback_employer_review_pending
    ON "Feedback".feedback_employer_review_deliveries (learner_id) WHERE employer_id IS NULL;
CREATE INDEX IF NOT EXISTS feedback_employer_review_form
    ON "Feedback".feedback_employer_review_deliveries (form_id);
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint
    WHERE conrelid = '"Feedback".feedback_forms'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  ALTER TABLE "Feedback".feedback_forms ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN ('general','post_lecture','post_event','event_rsvp','post_mcm_review',
      'post_progress_review','post_progress_review_employer','mid_module','end_module'));
END $$;

COMMIT;

-- Read-only verification: table, response link, indexes and supported types.
SELECT current_database() AS database_name,
       to_regclass('"Feedback".feedback_employer_review_deliveries') AS employer_delivery_table;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'Feedback' AND table_name = 'feedback_responses'
  AND column_name = 'employer_review_delivery_id';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'Feedback' AND indexname IN (
    'feedback_response_unique_employer_review', 'feedback_response_unique_general',
    'feedback_employer_review_owner', 'feedback_employer_review_pending', 'feedback_employer_review_form'
)
ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = '"Feedback".feedback_forms'::regclass
  AND conname = 'feedback_form_type_check';
