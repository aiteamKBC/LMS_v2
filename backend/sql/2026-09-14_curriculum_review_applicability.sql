-- Apply before deploying the Review applicability UI/API.
-- NULL keeps existing templates programme-wide.
BEGIN;
ALTER TABLE curriculum.review_templates
    ADD COLUMN IF NOT EXISTS applicability jsonb;
COMMIT;
