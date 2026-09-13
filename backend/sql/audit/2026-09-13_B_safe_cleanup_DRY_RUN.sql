-- ============================================================================
-- B. SAFE CLEANUP -- DRY RUN. SELECT only. Nothing is written.
--
-- Returns the EXACT rows that file C would delete, and nothing else. Run this
-- first, eyeball every row, and only then consider C.
--
-- Written for the Neon Web SQL Editor: plain SQL only, no psql
-- meta-commands. The editor returns one result grid per statement, so run a
-- single numbered block at a time when you want to read it closely.
--
-- The safety rule encoded below, applied to "Coach".coach_calendar_event:
--   * it is a review-driven row  (event_type in mcr / progress-review / review)
--   * status = 'not-scheduled'   (nobody has booked it)
--   * no scheduled date or time
--   * no Graph event, no Teams/meeting URL, no Graph organizer
--   * no answers, no completion timestamp, no manager signature
--   * no coach notes
--   * no meeting artifacts, attendance rows, attendance reports or AI summary
--   * its review_instance (if any) has no answers and no signatures
--   * it is regenerable: the Curriculum engine recomputes an unbooked
--     occurrence on every read, so deleting the row loses nothing
--
-- A row like this is almost always a failed-Teams-sync remnant
-- (repair_calendar_record_to_needs_schedule pushes a row back to
-- 'not-scheduled' after a sync failure) or a stale key from a since-changed
-- recurrence. Either way the engine regenerates the occurrence.
--
-- NOTE ON SCOPE: this file deliberately proposes NOTHING for review_templates,
-- review_types, coach_surface, Created_users."Start_date", progress_review_*
-- or the legacy public."MCR" / public.progress_review tables. Those are
-- configuration or history and are handled by decision, not by a cleanup script.
-- ============================================================================

-- === B1. coach_calendar_event rows that WOULD be deleted ===
WITH candidates AS (
    SELECT e.*
    FROM "Coach".coach_calendar_event e
    WHERE e.event_type IN ('mcr', 'progress-review', 'review')
      AND e.status = 'not-scheduled'
      AND e.scheduled_date IS NULL
      AND e.scheduled_time IS NULL
      AND nullif(btrim(e.graph_event_id), '')        IS NULL
      AND nullif(btrim(e.graph_web_link), '')        IS NULL
      AND nullif(btrim(e.meeting_link), '')          IS NULL
      AND nullif(btrim(e.graph_organizer_email), '') IS NULL
      AND nullif(btrim(e.notes), '')                 IS NULL
      AND e.review_completed_at IS NULL
      AND e.manager_signed_at   IS NULL
      AND coalesce(e.review_responses, '{}'::jsonb) = '{}'::jsonb
      -- no downstream meeting record of any kind
      AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_artifacts           a WHERE a.event_key = e.event_key)
      AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance          m WHERE m.event_key = e.event_key)
      AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance_reports  r WHERE r.event_key = e.event_key)
      AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_summaries           s WHERE s.event_key = e.event_key)
      -- and no review instance carrying learner work
      AND NOT EXISTS (
            SELECT 1
            FROM curriculum.review_instances i
            WHERE (i.calendar_event_id = e.id
                   OR i.id = nullif(btrim(e.review_instance_id), ''))
              AND (
                   i.completed_at IS NOT NULL
                OR i.started_at   IS NOT NULL
                OR EXISTS (SELECT 1 FROM curriculum.review_instance_answers    x WHERE x.review_instance_id = i.id)
                OR EXISTS (SELECT 1 FROM curriculum.review_instance_signatures y WHERE y.review_instance_id = i.id)
              )
      )
)
SELECT
    c.id, c.event_key, c.event_type, c.status,
    c.learner_id, c.learner_email, c.owner_email AS coach_email,
    c.sequence, c.occurrence_number, c.target_date,
    c.review_template_id, c.review_instance_id,
    c.sync_state, c.sync_attempt_count,
    nullif(btrim(c.last_graph_sync_error), '') AS last_sync_error,
    c.created_at, c.updated_at,
    -- why it is safe, restated per row so the reviewer can check it
    'not-scheduled; no graph/meeting; no answers/signature/notes; no artifacts/attendance/summary; regenerable'
        AS safety_reason
FROM candidates c
ORDER BY c.event_type, c.learner_id, c.target_date;

-- === B2. Count of B1, by event_type and sync_state ===
SELECT e.event_type, e.sync_state, count(*) AS rows_to_delete
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr', 'progress-review', 'review')
  AND e.status = 'not-scheduled'
  AND e.scheduled_date IS NULL AND e.scheduled_time IS NULL
  AND nullif(btrim(e.graph_event_id), '') IS NULL
  AND nullif(btrim(e.graph_web_link), '') IS NULL
  AND nullif(btrim(e.meeting_link), '')   IS NULL
  AND nullif(btrim(e.graph_organizer_email), '') IS NULL
  AND nullif(btrim(e.notes), '')          IS NULL
  AND e.review_completed_at IS NULL AND e.manager_signed_at IS NULL
  AND coalesce(e.review_responses, '{}'::jsonb) = '{}'::jsonb
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_artifacts          a WHERE a.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance         m WHERE m.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance_reports r WHERE r.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_summaries          s WHERE s.event_key = e.event_key)
GROUP BY e.event_type, e.sync_state
ORDER BY e.event_type, e.sync_state;

-- === B3. Empty review instances that WOULD be deleted ===
-- Only instances with nothing in them, not started, not completed, and whose
-- calendar row is itself either gone or in the B1 delete set.
SELECT
    i.id, i.review_template_id, i.learner_id, i.programme_id,
    i.occurrence_number, i.target_date, i.status,
    i.calendar_event_id, i.created_by, i.created_at,
    'no answers; no signatures; never started; never completed; regenerable by ensure_review_instance'
        AS safety_reason
FROM curriculum.review_instances i
WHERE i.completed_at IS NULL
  AND i.started_at   IS NULL
  AND coalesce(i.status, '') IN ('', 'not-scheduled')
  AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_answers    a WHERE a.review_instance_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s WHERE s.review_instance_id = i.id)
  AND (
        i.calendar_event_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.id = i.calendar_event_id)
     OR EXISTS (
            SELECT 1 FROM "Coach".coach_calendar_event e
            WHERE e.id = i.calendar_event_id
              AND e.status = 'not-scheduled'
              AND nullif(btrim(e.graph_event_id), '') IS NULL
              AND nullif(btrim(e.meeting_link), '')   IS NULL
        )
  )
ORDER BY i.created_at;

-- === B4. Dependency check -- anything still pointing at the B1/B3 rows ===
-- Must return ZERO rows before C is considered.
SELECT 'review_instance references a B1 calendar row' AS dependency,
       i.id AS review_instance_id, i.calendar_event_id AS coach_calendar_event_id
FROM curriculum.review_instances i
JOIN "Coach".coach_calendar_event e ON e.id = i.calendar_event_id
WHERE e.event_type IN ('mcr', 'progress-review', 'review')
  AND e.status = 'not-scheduled'
  AND nullif(btrim(e.graph_event_id), '') IS NULL
  AND (i.completed_at IS NOT NULL
       OR i.started_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM curriculum.review_instance_answers    a WHERE a.review_instance_id = i.id)
       OR EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s WHERE s.review_instance_id = i.id));
