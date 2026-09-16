-- Owner-run data repair in Neon SQL Editor. This file is NOT a migration.
-- Deploy the booking fix first; inspect section 1 before choosing IDs in 2.
-- No database has been inspected or changed by the agent.
--
-- Purpose: repair confirmed, already-linked bookings whose calendar is
-- scheduled but whose Review Instance is still not-scheduled.
-- Writes: only curriculum.review_instances.status, updated_by, updated_at.
-- Preserves: dates, Teams identifiers, answers, signatures, both snapshots.
-- No schema changes. Failed Teams sync does not invalidate a local booking.

-- 1. READ ONLY: review candidates and their linkage before selecting IDs.
SELECT i.id AS instance_id,
       e.id AS calendar_id,
       i.status AS instance_status,
       e.status AS calendar_status,
       e.scheduled_date,
       e.scheduled_time,
       e.sync_state,
       (i.calendar_event_id = e.id
        AND i.learner_id = e.learner_id
        AND i.review_template_id = e.review_template_id
        AND lower(trim(i.coach_email)) = lower(trim(e.owner_email))) AS link_matches,
       i.started_at,
       i.completed_at,
       EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s
                WHERE s.review_instance_id = i.id) AS has_signature_record
  FROM curriculum.review_instances i
  JOIN "Coach".coach_calendar_event e ON e.review_instance_id = i.id
 WHERE i.status = 'not-scheduled'
   AND e.status = 'scheduled'
 ORDER BY i.id, e.id;

-- 2. MANUAL REPAIR: replace the placeholder ONLY with reviewed instance IDs.
-- Left unchanged, this block updates zero rows. Add VALUES entries for any
-- additional reviewed IDs. A candidate failing a guard is deliberately skipped.
BEGIN;

WITH reviewed_ids(id) AS (
    VALUES ('REPLACE_WITH_REVIEW_INSTANCE_ID'::varchar)
), locked_events AS MATERIALIZED (
    SELECT e.*
      FROM "Coach".coach_calendar_event e
      JOIN reviewed_ids r ON r.id = e.review_instance_id
     ORDER BY e.id
     FOR UPDATE OF e
)
UPDATE curriculum.review_instances i
   SET status = 'scheduled',
       updated_by = 'manual-review-booking-status-repair',
       updated_at = current_timestamp AT TIME ZONE 'UTC'
  FROM locked_events e
 WHERE i.id = e.review_instance_id
   AND i.calendar_event_id = e.id
   AND i.learner_id = e.learner_id
   AND i.review_template_id = e.review_template_id
   AND lower(trim(i.coach_email)) = lower(trim(e.owner_email))
   AND trim(i.coach_email) <> ''
   AND i.status = 'not-scheduled'
   AND e.status = 'scheduled'
   AND e.scheduled_date IS NOT NULL
   AND e.scheduled_time IS NOT NULL
   AND e.sync_state IN ('pending', 'synced', 'failed')
   AND i.started_at IS NULL
   AND i.completed_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s
                    WHERE s.review_instance_id = i.id)
   AND NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event other
                    WHERE other.review_instance_id = i.id AND other.id <> e.id)
RETURNING i.id AS instance_id, e.id AS calendar_id, i.status, i.updated_by;

COMMIT;

-- 3. READ ONLY: substitute the same reviewed ID to verify both states.
SELECT i.id AS instance_id, i.status AS instance_status,
       e.id AS calendar_id, e.status AS calendar_status,
       i.updated_by, i.updated_at
  FROM curriculum.review_instances i
  JOIN "Coach".coach_calendar_event e
    ON e.id = i.calendar_event_id AND e.review_instance_id = i.id
 WHERE i.id IN ('REPLACE_WITH_REVIEW_INSTANCE_ID');
-- Expected for repaired records: scheduled / scheduled, unless a later
-- legitimate attendance/manual-start/signature transition has advanced them.
