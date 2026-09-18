-- OWNER-RUN BACKUP PREPARATION for cleanup_test_review_data.
--
-- This script WRITES BACKUP COPIES ONLY. It does not update or delete source
-- data and makes no Microsoft Graph calls. Run it in Neon SQL Editor only
-- after reviewing the strict Test allowlists in cleanup_test_review_data.py.

BEGIN;

CREATE TABLE IF NOT EXISTS "Coach".test_review_cleanup_backup_20260917 (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    parent_id text,
    payload jsonb NOT NULL,
    backed_up_at timestamptz NOT NULL DEFAULT current_timestamp,
    PRIMARY KEY (entity_type, entity_id)
);

WITH target_calendar_ids(id) AS (
    VALUES (129), (130), (133), (138)
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'calendar', e.id::text, e.learner_id::text, to_jsonb(e)
  FROM "Coach".coach_calendar_event e
  JOIN target_calendar_ids t ON t.id = e.id
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

WITH target_calendar_ids(id) AS (
    VALUES (129), (130), (133), (138)
), target_instances AS (
    SELECT DISTINCT NULLIF(BTRIM(e.review_instance_id), '') AS id
      FROM "Coach".coach_calendar_event e
      JOIN target_calendar_ids t ON t.id = e.id
     WHERE NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'review_instance', i.id, i.calendar_event_id::text, to_jsonb(i)
  FROM curriculum.review_instances i
  JOIN target_instances t ON t.id = i.id
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

WITH target_calendar_ids(id) AS (
    VALUES (129), (130), (133), (138)
), target_instances AS (
    SELECT DISTINCT NULLIF(BTRIM(e.review_instance_id), '') AS id
      FROM "Coach".coach_calendar_event e
      JOIN target_calendar_ids t ON t.id = e.id
     WHERE NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'review_answer', a.id, a.review_instance_id, to_jsonb(a)
  FROM curriculum.review_instance_answers a
  JOIN target_instances t ON t.id = a.review_instance_id
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

WITH target_calendar_ids(id) AS (
    VALUES (129), (130), (133), (138)
), target_instances AS (
    SELECT DISTINCT NULLIF(BTRIM(e.review_instance_id), '') AS id
      FROM "Coach".coach_calendar_event e
      JOIN target_calendar_ids t ON t.id = e.id
     WHERE NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'review_signature', s.id, s.review_instance_id, to_jsonb(s)
  FROM curriculum.review_instance_signatures s
  JOIN target_instances t ON t.id = s.review_instance_id
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

WITH target_calendar_ids(id) AS (
    VALUES (129), (130), (133), (138)
), target_instances AS (
    SELECT DISTINCT NULLIF(BTRIM(e.review_instance_id), '') AS id
      FROM "Coach".coach_calendar_event e
      JOIN target_calendar_ids t ON t.id = e.id
     WHERE NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'review_manual_override', o.id, o.review_instance_id, to_jsonb(o)
  FROM curriculum.review_instance_manual_overrides o
  JOIN target_instances t ON t.id = o.review_instance_id
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

-- Every submission whose stale monthlyAssignment.meetingKey the cleanup will
-- repair. These rows are NEVER deleted -- only the dead nested pointer is
-- cleared -- but the pre-repair payload is backed up so the original
-- meetingKey can always be recovered. Identified in SUBMISSION id space.
WITH target_submissions(id) AS (
    VALUES
      ('d14c4a32-8139-45c4-9b1e-92933ceb612d'),  -- learner 499 Ayman
      ('77c76d01-be3d-4641-baa4-4917f2032d8b'),  -- learner 101 Aya
      ('bfffba78-3f83-4778-8edd-c6c853395072'),  -- learner 101 Aya
      ('d551505d-478d-4210-93aa-9798703f04ae'),  -- learner 101 Aya
      ('321c6951-5916-43b9-9b50-b80b7d2fe538')   -- learner 501 QA
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT 'assignment_submission', s.id::text, s.learner_id::text, to_jsonb(s)
  FROM "Learner".learning_reflection_submissions s
  JOIN target_submissions t ON t.id = s.id::text
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

-- Meeting-owned dependencies are captured generically. The md5 key is only
-- the immutable backup-row identity; the complete original row is in payload.
WITH target_calendar AS (
    SELECT id, event_key
     FROM "Coach".coach_calendar_event
     WHERE id = ANY(ARRAY[129,130,133,138])
), dependency_rows AS (
    SELECT 'meeting_attendance'::text AS entity_type,
           a.calendar_event_id::text AS parent_id, to_jsonb(a) AS payload
      FROM "Coach".coach_meeting_attendance a
     WHERE EXISTS (SELECT 1 FROM target_calendar t
                    WHERE t.id = a.calendar_event_id OR t.event_key = a.event_key)
    UNION ALL
    SELECT 'meeting_attendance_report', r.calendar_event_id::text, to_jsonb(r)
      FROM "Coach".coach_meeting_attendance_reports r
     WHERE EXISTS (SELECT 1 FROM target_calendar t
                    WHERE t.id = r.calendar_event_id OR t.event_key = r.event_key)
    UNION ALL
    SELECT 'meeting_artifact', a.calendar_event_id::text, to_jsonb(a)
      FROM "Coach".coach_meeting_artifacts a
     WHERE EXISTS (SELECT 1 FROM target_calendar t
                    WHERE t.id = a.calendar_event_id OR t.event_key = a.event_key)
    UNION ALL
    SELECT 'meeting_summary', s.calendar_event_id::text, to_jsonb(s)
      FROM "Coach".coach_meeting_summaries s
     WHERE EXISTS (SELECT 1 FROM target_calendar t
                    WHERE t.id = s.calendar_event_id OR t.event_key = s.event_key)
)
INSERT INTO "Coach".test_review_cleanup_backup_20260917
    (entity_type, entity_id, parent_id, payload)
SELECT entity_type, md5(payload::text), parent_id, payload
  FROM dependency_rows
ON CONFLICT (entity_type, entity_id) DO UPDATE
   SET parent_id = EXCLUDED.parent_id,
       payload = EXCLUDED.payload,
       backed_up_at = current_timestamp;

COMMIT;

-- READ-ONLY verification. The cleanup command performs stronger per-target
-- coverage checks before either --cancel-external or --apply.
SELECT entity_type, COUNT(*) AS rows
  FROM "Coach".test_review_cleanup_backup_20260917
 GROUP BY entity_type
 ORDER BY entity_type;
