-- Run manually in the Neon SQL Editor for the database containing the Coach schema.
-- Existing reports keep an unspecified recovery method; new learner reports require a choice.
BEGIN;

-- Meeting and progress-review absences use a stable synthetic attendance ID
-- because those appointments do not have a row in the lecture attendance
-- table. The legacy FK therefore prevents valid meeting reports from being
-- stored. The Django migration 0010 applies this same change for deployments
-- that run migrations; keep this idempotent statement for owner-run SQL setup.
ALTER TABLE "Coach".coach_absence_report
  DROP CONSTRAINT IF EXISTS coach_absence_report_attendance_fk;

ALTER TABLE "Coach".coach_absence_report
  ADD COLUMN IF NOT EXISTS recovery_method varchar(16) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS catchup_event_key varchar(255);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_absence_recovery_valid'
                 AND conrelid = '"Coach".coach_absence_report'::regclass) THEN
    ALTER TABLE "Coach".coach_absence_report ADD CONSTRAINT coach_absence_recovery_valid
      CHECK ((recovery_method IN ('', 'recorded') AND catchup_event_key IS NULL)
          OR (recovery_method = 'catch-up' AND catchup_event_key IS NOT NULL AND catchup_event_key <> ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coach_absence_catchup_event_fk'
                 AND conrelid = '"Coach".coach_absence_report'::regclass) THEN
    ALTER TABLE "Coach".coach_absence_report ADD CONSTRAINT coach_absence_catchup_event_fk
      FOREIGN KEY (catchup_event_key) REFERENCES "Coach".coach_calendar_event(event_key) ON DELETE RESTRICT;
  END IF;
END $$;
COMMIT;
