-- Module midpoint/end feedback schema update.
-- Matches engagement_api migration 0006_module_feedback.
-- Run against the application's PostgreSQL database containing the "Feedback" schema.
-- This script changes schema only; it does not publish forms or generate responses.
-- Manual execution does not record the Django migration as applied.

BEGIN;

ALTER TABLE "Feedback".feedback_delivery_recipients
  ADD COLUMN IF NOT EXISTS available_at timestamptz NULL;

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"Feedback".feedback_forms'::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  ALTER TABLE "Feedback".feedback_forms ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN ('general', 'post_lecture', 'post_event', 'event_rsvp',
                        'post_mcm_review', 'post_progress_review', 'mid_module', 'end_module'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_module_template_published_scope
  ON "Feedback".feedback_forms (form_type, delivery_scope, module_catalogue_id)
  WHERE form_type IN ('mid_module', 'end_module') AND is_current AND status = 'published';

CREATE INDEX IF NOT EXISTS feedback_module_recipient_available
  ON "Feedback".feedback_delivery_recipients (learner_id, available_at)
  WHERE available_at IS NOT NULL;

COMMIT;

-- Read-only verification: expect the nullable timestamp column, the form-type
-- constraint containing mid_module/end_module, and both named indexes.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'Feedback'
  AND table_name = 'feedback_delivery_recipients'
  AND column_name = 'available_at';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = '"Feedback".feedback_forms'::regclass
  AND conname = 'feedback_form_type_check';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'Feedback'
  AND indexname IN ('feedback_module_template_published_scope',
                    'feedback_module_recipient_available')
ORDER BY indexname;
