-- Progress Review: the learner-progress figures one Review Instance froze.
--
-- Purpose
--   A Progress Review records where ONE learner stood at ONE moment. When the
--   coach presses Calculate, the backend computes that learner's cumulative
--   progress from their own programme start date
--   (enrolment."Created_users"."Learner_start_date" -- never a group, cohort,
--   programme-template, module or review date) up to the server's own clock at
--   that moment, and stores the result here. The review form, the completed
--   read-only review and the signed PDF all render THIS stored value; none of
--   them recalculates, so a review signed today still shows today's figures
--   when it is opened or exported in two years.
--
-- Affected records
--   curriculum.review_instances -- one new nullable column. No existing row is
--   modified: every instance created before this runs simply has no snapshot
--   yet and reads as "not calculated", which is the correct history for a
--   review that never had one. Nothing is backfilled, and no other table,
--   column, constraint or index is touched.
--
--   Deliberately NOT stored inside the existing definition_snapshot column:
--   that one freezes the QUESTION SET once, at instance creation, and must not
--   start being rewritten every time a coach recalculates.
--
-- Run against Neon directly -- see backend/sql conventions.
BEGIN;

ALTER TABLE curriculum.review_instances
    ADD COLUMN IF NOT EXISTS progress_snapshot jsonb;

COMMENT ON COLUMN curriculum.review_instances.progress_snapshot IS
    'Frozen learner-progress figures calculated for this review instance '
    '(calculationMethod, calculatedFrom = the learner''s own programme start '
    'date, calculatedAt = backend server time, and the off-the-job hours / '
    'programme progress actual, expected and variance values). Written when a '
    'coach presses Calculate, replaceable until the signature step begins, '
    'read-only afterwards. Readers must render this value, never recalculate.';

COMMIT;

-- Read-only verification (expects one row: progress_snapshot | jsonb | YES):
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'curriculum'
--      AND table_name   = 'review_instances'
--      AND column_name  = 'progress_snapshot';
--
-- And to confirm nothing was backfilled (expects 0):
--
--   SELECT count(*) FROM curriculum.review_instances
--    WHERE progress_snapshot IS NOT NULL;
