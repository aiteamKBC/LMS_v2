-- Run manually in the Neon SQL Editor against the intended database branch.
-- Keeps the Teams meeting ID and passcode Microsoft prints under a join link,
-- beside the link they were read for (see curriculum_api/teams_dial_in.py).
-- Additive only: existing rows get blanks and fill on their next session sync.
BEGIN;

ALTER TABLE curriculum.live_sessions
    ADD COLUMN IF NOT EXISTS join_meeting_code text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS join_passcode text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS dial_in_join_url text NOT NULL DEFAULT '';

COMMIT;

-- Verify:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'curriculum' AND table_name = 'live_sessions'
--    AND column_name IN ('join_meeting_code', 'join_passcode', 'dial_in_join_url');
