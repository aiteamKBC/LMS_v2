-- Coach status vocabulary CHECK constraints.
-- Mirrors CoachCalendarEvent.STATUS_CHOICES and CoachAbsenceReport.STATUS_CHOICES
-- in backend/coach_api/models.py. Run directly on PostgreSQL (Neon) -- no
-- Django migration is applied against this database.
--
-- Not idempotent to re-run as-is: Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS, so running this twice will fail with "constraint already exists"
-- on the second run. That failure is harmless (it means the constraint is
-- already in place) -- just don't wrap it in anything that treats any error
-- as fatal to a larger script.
--
-- Before running: check for rows that would violate the new constraint.
-- Each SELECT below should return 0 rows. If either returns rows, fix or
-- normalise that data first -- the ALTER TABLE will reject the constraint
-- otherwise.

SELECT id, event_key, status
FROM "Coach".coach_calendar_event
WHERE status NOT IN (
    'not-scheduled', 'scheduled', 'in-progress',
    'awaiting-signature', 'completed', 'cancelled'
);

SELECT id, status
FROM "Coach".coach_absence_report
WHERE status NOT IN ('pending', 'approved', 'declined');

BEGIN;

ALTER TABLE "Coach".coach_calendar_event
    ADD CONSTRAINT coach_calendar_event_status_valid
    CHECK (status IN (
        'not-scheduled', 'scheduled', 'in-progress',
        'awaiting-signature', 'completed', 'cancelled'
    ));

ALTER TABLE "Coach".coach_absence_report
    ADD CONSTRAINT coach_absence_report_status_valid
    CHECK (status IN ('pending', 'approved', 'declined'));

COMMIT;
