-- Manual equivalent of engagement_api.0012_epa_review_feedback.
-- Verify the intended LMS database and backup/restore point before execution.
-- No forms, deliveries, answers or historical reviews are inserted or changed.
-- A later normal Django migration can repeat this schema operation; do not --fake.
BEGIN;
SET LOCAL statement_timeout = '30s';

SET LOCAL lock_timeout = '5s';
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
      'post_progress_review','post_progress_review_employer','post_epa_review','mid_module','end_module'));
END $$;

COMMIT;

-- Read-only verification.
SELECT current_database() AS database_name;
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = '"Feedback".feedback_forms'::regclass
  AND conname = 'feedback_form_type_check';
