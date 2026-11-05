-- Feedback triggered only by reviews completed after the matching form was
-- first published. Applying this migration does not backfill historical rows.

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'Feedback' AND t.relname = 'feedback_forms'
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  ALTER TABLE "Feedback".feedback_forms
    ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN (
      'general','post_lecture','post_event','event_rsvp',
      'post_mcm_review','post_progress_review'
    ));
END $$;

CREATE TABLE IF NOT EXISTS "Feedback".feedback_review_deliveries (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    source_review_id bigint NOT NULL UNIQUE,
    aptem_review_id text NOT NULL DEFAULT '',
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL DEFAULT '',
    review_type varchar(255) NOT NULL,
    review_name varchar(500) NOT NULL DEFAULT '',
    completed_at timestamptz NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "Feedback".feedback_responses
  ADD COLUMN IF NOT EXISTS review_delivery_id bigint NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'feedback_response_review_delivery_fk'
       AND conrelid = '"Feedback".feedback_responses'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_responses
      ADD CONSTRAINT feedback_response_review_delivery_fk
      FOREIGN KEY (review_delivery_id)
      REFERENCES "Feedback".feedback_review_deliveries(id) ON DELETE RESTRICT;
  END IF;
END $$;

DROP INDEX IF EXISTS "Feedback".feedback_response_unique_general;
CREATE UNIQUE INDEX feedback_response_unique_general
  ON "Feedback".feedback_responses (form_id, learner_id)
  WHERE delivery_id IS NULL AND event_recipient_id IS NULL
    AND rsvp_recipient_id IS NULL AND review_delivery_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_review_delivery
  ON "Feedback".feedback_responses (review_delivery_id)
  WHERE review_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_review_deliveries_learner
  ON "Feedback".feedback_review_deliveries (learner_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS feedback_review_deliveries_form
  ON "Feedback".feedback_review_deliveries (form_id, completed_at DESC);
