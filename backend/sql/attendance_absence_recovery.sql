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

-- Alternative attendance stores an occurrence identity in the same bounded
-- reference column (alternative:OCC-...). It is deliberately not a coach
-- calendar event, so the old unconditional FK rejected every valid alternative
-- report. Catch-up ownership and availability are checked and locked by the
-- application before the report is inserted.
ALTER TABLE "Coach".coach_absence_report
  DROP CONSTRAINT IF EXISTS coach_absence_catchup_event_fk,
  DROP CONSTRAINT IF EXISTS coach_absence_recovery_valid;

ALTER TABLE "Coach".coach_absence_report
  ADD CONSTRAINT coach_absence_recovery_valid CHECK (
       (recovery_method IN ('', 'recorded') AND catchup_event_key IS NULL)
    OR (recovery_method = 'catch-up'
        AND catchup_event_key IS NOT NULL
        AND catchup_event_key <> ''
        AND catchup_event_key NOT LIKE 'alternative:%')
    OR (recovery_method = 'alternative'
        AND catchup_event_key LIKE 'alternative:%'
        AND length(catchup_event_key) > length('alternative:'))
  );
COMMIT;
