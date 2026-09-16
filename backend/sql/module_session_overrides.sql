-- Explicit per-session dates/times, without changing the group's weekly rule.
ALTER TABLE curriculum.modules
    ADD COLUMN IF NOT EXISTS session_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Verify after applying:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'curriculum' AND table_name = 'modules'
--   AND column_name = 'session_overrides';
