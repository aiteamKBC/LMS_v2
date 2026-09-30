-- Declared completion instants on learner progress.
--
-- submitted_at already holds the real moment the learner pressed Finish and is
-- written once per row (LearnerProgressEntry rows are only ever created, never
-- updated), so it stays as the immutable audit timestamp.
--
-- declared_completed_at holds the working instant the learner declared when
-- that click fell outside the working rules; submission_validation_reason says
-- why the click was refused ('weekend', 'outside_working_hours', 'holiday').
-- Both are NULL/'' for a completion that was already valid when it was made.
--
-- Existing inside_working_hours_confirmed / outside_working_hours_confirmed
-- columns are deliberately untouched: they record consent that was genuinely
-- asked for at the time and must keep their current meaning.

ALTER TABLE "Learner".learner_progress_entries
    ADD COLUMN IF NOT EXISTS declared_completed_at timestamp with time zone NULL;

ALTER TABLE "Learner".learner_progress_entries
    ADD COLUMN IF NOT EXISTS submission_validation_reason varchar(32) NOT NULL DEFAULT '';

-- Verification (expects both rows):
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'Learner'
--    AND table_name = 'learner_progress_entries'
--    AND column_name IN ('declared_completed_at', 'submission_validation_reason')
--  ORDER BY column_name;
