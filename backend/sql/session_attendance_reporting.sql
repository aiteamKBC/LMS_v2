-- OWNER RUN ONLY. Existing Teams reporting prerequisites, extracted from the old
-- runtime repair. Adds metadata columns/indexes; backfills missing metadata only.
-- Removes the obsolete Absence-table trigger; does not recalculate attendance.
BEGIN;
DROP TRIGGER IF EXISTS learner_attendance_details_sync_absence_counts
ON "Learner"."learner_attendance_details";

ALTER TABLE "Learner"."learner_attendance_details"
    ADD COLUMN IF NOT EXISTS attended_seconds integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attendance_report_id text,
    ADD COLUMN IF NOT EXISTS live_session_id text,
    ADD COLUMN IF NOT EXISTS source varchar(40) NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS enrolment_id bigint,
    ADD COLUMN IF NOT EXISTS learner_profile_id bigint,
    ADD COLUMN IF NOT EXISTS occurrence_id text,
    ADD COLUMN IF NOT EXISTS module_catalogue_id text,
    ADD COLUMN IF NOT EXISTS group_id text,
    ADD COLUMN IF NOT EXISTS group_name text,
    ADD COLUMN IF NOT EXISTS is_expected boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS eligibility_reason varchar(80),
    ADD COLUMN IF NOT EXISTS source_record_id text,
    ADD COLUMN IF NOT EXISTS scheduled_start timestamp with time zone,
    ADD COLUMN IF NOT EXISTS scheduled_end timestamp with time zone,
    ADD COLUMN IF NOT EXISTS actual_start timestamp with time zone,
    ADD COLUMN IF NOT EXISTS actual_end timestamp with time zone,
    ADD COLUMN IF NOT EXISTS first_join_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS last_leave_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS calculated_at timestamp with time zone;

UPDATE "Learner"."learner_attendance_details"
SET learner_profile_id = COALESCE(learner_profile_id, learner_id),
    occurrence_id = COALESCE(NULLIF(occurrence_id, ''), session_id),
    calculated_at = COALESCE(calculated_at, synced_at, updated_at, created_at)
WHERE source = 'microsoft_teams'
  AND (
        learner_profile_id IS NULL
     OR occurrence_id IS NULL
     OR occurrence_id = ''
     OR calculated_at IS NULL
  );

UPDATE "Learner"."learner_attendance_details" attendance
SET module_catalogue_id = session.module_catalogue_id,
    group_id = module.group_id,
    group_name = module.group_name
FROM curriculum.live_sessions session
LEFT JOIN curriculum.modules module
       ON module.module_catalogue_id = session.module_catalogue_id
WHERE attendance.source = 'microsoft_teams'
  AND attendance.live_session_id = session.id
  AND (
        attendance.module_catalogue_id IS NULL
     OR attendance.group_id IS NULL
     OR attendance.group_name IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_attendance_details_source
ON "Learner"."learner_attendance_details" (source);

CREATE INDEX IF NOT EXISTS idx_attendance_details_learner_source_date
ON "Learner"."learner_attendance_details" (learner_id, source, session_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_details_module_group
ON "Learner"."learner_attendance_details" (module_catalogue_id, group_id)
WHERE source = 'microsoft_teams' AND is_expected;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_details_profile_occurrence
ON "Learner"."learner_attendance_details" (learner_profile_id, occurrence_id)
WHERE source = 'microsoft_teams'
  AND learner_profile_id IS NOT NULL
  AND occurrence_id IS NOT NULL;

CREATE OR REPLACE VIEW "Learner"."verified_teams_attendance" AS
SELECT *
FROM "Learner"."learner_attendance_details"
WHERE source = 'microsoft_teams' AND is_expected;
COMMIT;

-- Read-only verification:
SELECT column_name,data_type FROM information_schema.columns
WHERE table_schema='Learner' AND table_name='learner_attendance_details' ORDER BY ordinal_position;
