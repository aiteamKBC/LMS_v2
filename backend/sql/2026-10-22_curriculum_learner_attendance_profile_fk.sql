-- Keep Curriculum attendance rows linked to the Learner profile identity.
-- The constraint is intentionally NOT VALID because five historical rows point
-- to one retired profile id. New rows are checked immediately; validate this
-- constraint only after those historical rows have an approved mapping.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'curriculum.live_session_learner_attendance'::regclass
          AND conname = 'curriculum_live_learner_attendance_profile_fk'
    ) THEN
        ALTER TABLE curriculum.live_session_learner_attendance
            ADD CONSTRAINT curriculum_live_learner_attendance_profile_fk
            FOREIGN KEY (learner_profile_id)
            REFERENCES "Learner".learners(id)
            NOT VALID;
    END IF;
END $$;
