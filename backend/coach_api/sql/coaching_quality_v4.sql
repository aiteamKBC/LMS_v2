-- Whole-lecture teaching reviews share immutable form/evidence/revision storage.
-- Existing coaching reviews still require their real learner identity.
ALTER TABLE lms_quality.review ALTER COLUMN learner_id DROP NOT NULL;
ALTER TABLE lms_quality.review ALTER COLUMN learner_name DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid='lms_quality.review'::regclass AND conname='quality_review_subject') THEN
    ALTER TABLE lms_quality.review ADD CONSTRAINT quality_review_subject CHECK (
      (coalesce(payload->>'scope','coaching')='teaching' AND learner_id IS NULL AND learner_name IS NULL
       AND coalesce(payload->>'reviewType','')='FORM_TEACHING' AND payload->'lecture'->>'occurrenceId' IS NOT NULL)
      OR (coalesce(payload->>'scope','coaching')='coaching' AND learner_id IS NOT NULL AND learner_name IS NOT NULL)
    );
  END IF;
END $$;
