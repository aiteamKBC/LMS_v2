-- ============================================================================
-- C. PROPOSED CLEANUP -- wrapped in BEGIN ... ROLLBACK.
--
-- THIS FILE ENDS IN ROLLBACK. Running it as-is changes NOTHING. It exists so
-- the row counts and the verification queries can be seen against real data
-- inside a transaction that is then thrown away.
--
-- Written for the Neon Web SQL Editor: plain SQL only, no psql meta-commands.
-- Run the WHOLE file in one go -- BEGIN, the statements and ROLLBACK must
-- share a single session, or the temp tables and the rollback are lost.
--
-- Do NOT change ROLLBACK to COMMIT until:
--   1. file A has been run and read,
--   2. file B returns exactly the rows you intend to lose and B4 returns zero,
--   3. a Neon branch/snapshot exists to restore from,
--   4. someone other than the author has signed the row list off.
--
-- Ordering matters: children before parents.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 0. Freeze the candidate sets so every later statement and every
-- verification query operates on exactly the same rows.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _doomed_events ON COMMIT DROP AS
SELECT e.id, e.event_key, e.event_type, e.learner_id, e.target_date,
       e.review_template_id, e.review_instance_id
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
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_artifacts          a WHERE a.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance         m WHERE m.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_attendance_reports r WHERE r.event_key = e.event_key)
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_meeting_summaries          s WHERE s.event_key = e.event_key)
  AND NOT EXISTS (
        SELECT 1 FROM curriculum.review_instances i
        WHERE (i.calendar_event_id = e.id OR i.id = nullif(btrim(e.review_instance_id), ''))
          AND (i.completed_at IS NOT NULL
            OR i.started_at   IS NOT NULL
            OR EXISTS (SELECT 1 FROM curriculum.review_instance_answers    x WHERE x.review_instance_id = i.id)
            OR EXISTS (SELECT 1 FROM curriculum.review_instance_signatures y WHERE y.review_instance_id = i.id))
  );

CREATE TEMP TABLE _doomed_instances ON COMMIT DROP AS
SELECT i.id, i.review_template_id, i.learner_id, i.occurrence_number, i.target_date
FROM curriculum.review_instances i
WHERE i.completed_at IS NULL
  AND i.started_at   IS NULL
  AND coalesce(i.status, '') IN ('', 'not-scheduled')
  AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_answers    a WHERE a.review_instance_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s WHERE s.review_instance_id = i.id)
  AND (
        i.calendar_event_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.id = i.calendar_event_id)
     OR i.calendar_event_id IN (SELECT id FROM _doomed_events)
  );

-- --- candidate counts inside the transaction ---
SELECT 'coach_calendar_event' AS relation, count(*) AS rows FROM _doomed_events
UNION ALL
SELECT 'curriculum.review_instances', count(*) FROM _doomed_instances;

-- ---------------------------------------------------------------------------
-- GUARD. Abort immediately if anything with learner work sneaked into a set.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
    unsafe integer;
BEGIN
    SELECT count(*) INTO unsafe
    FROM _doomed_instances d
    WHERE EXISTS (SELECT 1 FROM curriculum.review_instance_answers    a WHERE a.review_instance_id = d.id)
       OR EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s WHERE s.review_instance_id = d.id);
    IF unsafe > 0 THEN
        RAISE EXCEPTION 'Refusing to proceed: % review instance(s) in the delete set carry answers or signatures.', unsafe;
    END IF;

    SELECT count(*) INTO unsafe
    FROM _doomed_events d
    JOIN "Coach".coach_calendar_event e ON e.id = d.id
    WHERE e.status <> 'not-scheduled'
       OR nullif(btrim(e.graph_event_id), '') IS NOT NULL;
    IF unsafe > 0 THEN
        RAISE EXCEPTION 'Refusing to proceed: % calendar row(s) in the delete set are booked or have a Graph event.', unsafe;
    END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- Step 1. Unlink before deleting, so no row is orphaned mid-transaction.
-- ---------------------------------------------------------------------------
UPDATE curriculum.review_instances
   SET calendar_event_id = NULL,
       updated_at        = now()
 WHERE calendar_event_id IN (SELECT id FROM _doomed_events);

UPDATE "Coach".coach_calendar_event
   SET review_instance_id = '',
       updated_at         = now()
 WHERE review_instance_id IN (SELECT id FROM _doomed_instances);

-- ---------------------------------------------------------------------------
-- Step 2. Delete the empty review instances (children first).
-- Both child tables should already be empty for these ids; the deletes are
-- belt-and-braces so a stray row cannot survive as an orphan.
-- ---------------------------------------------------------------------------
DELETE FROM curriculum.review_instance_answers
 WHERE review_instance_id IN (SELECT id FROM _doomed_instances);

DELETE FROM curriculum.review_instance_signatures
 WHERE review_instance_id IN (SELECT id FROM _doomed_instances);

DELETE FROM curriculum.review_instances
 WHERE id IN (SELECT id FROM _doomed_instances);

-- ---------------------------------------------------------------------------
-- Step 3. Delete the unbooked, inert calendar rows.
-- The Curriculum engine regenerates these occurrences on the next read.
-- ---------------------------------------------------------------------------
DELETE FROM "Coach".coach_calendar_event
 WHERE id IN (SELECT id FROM _doomed_events);

-- ---------------------------------------------------------------------------
-- VERIFICATION -- read these before deciding anything.
-- ---------------------------------------------------------------------------
-- --- V1. nothing historical was touched (all three must be 0) ---
SELECT 'completed review events remaining' AS check_name,
       count(*) FILTER (WHERE e.review_completed_at IS NOT NULL) AS value
FROM "Coach".coach_calendar_event e WHERE e.event_type IN ('mcr','progress-review','review')
UNION ALL
SELECT 'answers orphaned by this transaction',
       count(*) FROM curriculum.review_instance_answers a
       WHERE NOT EXISTS (SELECT 1 FROM curriculum.review_instances i WHERE i.id = a.review_instance_id)
UNION ALL
SELECT 'signatures orphaned by this transaction',
       count(*) FROM curriculum.review_instance_signatures s
       WHERE NOT EXISTS (SELECT 1 FROM curriculum.review_instances i WHERE i.id = s.review_instance_id);

-- --- V2. meeting artifacts / attendance / summaries still intact ---
SELECT 'coach_meeting_artifacts'           AS relation, count(*) AS rows FROM "Coach".coach_meeting_artifacts
UNION ALL SELECT 'coach_meeting_attendance',         count(*) FROM "Coach".coach_meeting_attendance
UNION ALL SELECT 'coach_meeting_attendance_reports', count(*) FROM "Coach".coach_meeting_attendance_reports
UNION ALL SELECT 'coach_meeting_summaries',          count(*) FROM "Coach".coach_meeting_summaries
UNION ALL SELECT 'progress_review_runs',             count(*) FROM "Learner"."progress_review_runs"
UNION ALL SELECT 'progress_review_pptx_files',       count(*) FROM "Learner"."progress_review_pptx_files";

-- --- V3. no artifact/attendance row now points at a deleted event_key ---
SELECT 'artifacts orphaned' AS check_name, count(*) AS value
FROM "Coach".coach_meeting_artifacts a
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = a.event_key)
UNION ALL
SELECT 'attendance orphaned', count(*)
FROM "Coach".coach_meeting_attendance m
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = m.event_key)
UNION ALL
SELECT 'summaries orphaned', count(*)
FROM "Coach".coach_meeting_summaries s
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = s.event_key);

-- --- V4. remaining review rows still carry their Curriculum linkage ---
SELECT e.event_type,
       count(*)                                                          AS rows,
       count(*) FILTER (WHERE nullif(btrim(e.review_template_id),'') IS NULL) AS missing_template_link
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr','progress-review','review')
GROUP BY e.event_type
ORDER BY e.event_type;

-- ============================================================================
-- NOTHING ABOVE IS KEPT.
-- ============================================================================
ROLLBACK;

-- ============================================================================
-- DELIBERATELY NOT PROPOSED HERE -- decisions, not cleanup:
--
--   * curriculum.review_templates.coach_surface  (drop column)
--       Already staged as a commented follow-up in
--       sql/2026-09-13_curriculum_review_types.sql. Run that, not this.
--
--   * public."MCR" / public.progress_review
--       Legacy import tables. No production code reads them
--       (fetch_timetable_source_rows / extract_mcr_events /
--       extract_progress_review_events have no callers). Archive to a
--       snapshot before dropping; they may be the only surviving record of
--       the pre-LMS Aptem schedule.
--
--   * enrolment."Created_users"."Start_date"
--       DO NOT rewrite. There is no provenance column, so a value written by
--       the 2026-09-12 cohort backfill is indistinguishable from a learner who
--       genuinely started on their cohort's first day. Correct these one at a
--       time against the enrolment paperwork, never in bulk.
--
--   * "Learner".progress_review_runs / _source_snapshots / _pptx_files
--       Historical generated output. Never delete as part of this cleanup.
-- ============================================================================
