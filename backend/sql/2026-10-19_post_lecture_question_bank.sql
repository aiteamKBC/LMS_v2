-- Apply after 2026-09-20_feedback_forms.sql on the verified Feedback database.
-- Existing lecture deliveries keep their full historical question sets.
-- Run this schema addition before deploying the code that reads these columns.
ALTER TABLE "Feedback".feedback_form_sections
  ADD COLUMN IF NOT EXISTS questions_per_delivery integer NULL;

ALTER TABLE "Feedback".feedback_deliveries
  ADD COLUMN IF NOT EXISTS question_set_pinned boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_section_questions_per_delivery_positive'
      AND conrelid = '"Feedback".feedback_form_sections'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_form_sections
      ADD CONSTRAINT feedback_section_questions_per_delivery_positive
      CHECK (questions_per_delivery IS NULL OR questions_per_delivery > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Feedback".feedback_delivery_questions (
  id bigserial PRIMARY KEY,
  delivery_id bigint NOT NULL REFERENCES "Feedback".feedback_deliveries(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (delivery_id, question_id)
);

CREATE INDEX IF NOT EXISTS feedback_delivery_questions_order
  ON "Feedback".feedback_delivery_questions (delivery_id, sort_order);
