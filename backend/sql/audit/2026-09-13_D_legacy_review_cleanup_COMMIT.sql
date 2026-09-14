-- ============================================================================
-- D. FINAL CLEANUP -- BEGIN ... COMMIT. THIS SCRIPT WRITES.
--
-- Deletes the 23 legacy Coach MCM / Progress Review calendar rows and the
-- local meeting data that belongs exclusively to them, at every status
-- (not-scheduled, scheduled, in-progress, awaiting-signature, completed,
-- cancelled). The loss of that old calendar history is accepted, explicitly.
--
-- LEGACY SET, and nothing else:
--     event_type IN ('mcr','progress-review')
--     AND NULLIF(BTRIM(review_template_id), '') IS NULL
--     AND NULLIF(BTRIM(review_instance_id),  '') IS NULL
--
-- NEVER TOUCHED BY THIS SCRIPT:
--     curriculum.review_types
--     curriculum.review_templates
--     curriculum.review_instances (and its answers / signatures)
--     curriculum.review_occurrence_overrides / review_clash_resolutions
--     "Coach".coach_calendar_event rows with event_type = 'review'
--     "Coach".coach_calendar_event rows carrying ANY Curriculum linkage
--     "Coach".coach_calendar_sequence   (a counter -- resetting it would let a
--                                        future event_key collide with a
--                                        deleted one; left deliberately alone)
--     "Coach".coach_absence_report      (keyed on attendance_id, not on any
--                                        calendar event)
--     "Learner".progress_review_runs / _source_snapshots / _pptx_files
--                                       (see section 6 -- they cannot be tied
--                                        to a specific calendar event, so they
--                                        are reported and kept)
--
-- FIVE ABORT GUARDS run before the first DELETE. Any one of them raises and
-- rolls the whole transaction back:
--     G1  candidate count is not exactly 23
--     G2  a candidate has review_template_id populated
--     G3  a candidate has review_instance_id populated
--     G4  a curriculum.review_instance points at a candidate via
--         calendar_event_id (a one-sided link the premise says cannot exist;
--         there is no FK enforcing it, so it is checked explicitly)
--     G5  the backup table does not hold all 23 ids
--
-- Written for the Neon Web SQL Editor: plain SQL, no psql meta-commands.
-- RUN THE WHOLE FILE IN ONE GO -- BEGIN, the guards, the deletes and COMMIT
-- must share one session.
--
-- EXTERNAL MICROSOFT GRAPH / TEAMS MEETINGS ARE **NOT** DELETED.
-- Deleting a row here does not call Graph. Section 4 reports which rows carry
-- a graph_event_id so you can decide separately. See the closing note.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Freeze the legacy set. Every later statement reads from this, so the
--    guards, the backup, the deletes and the verification all operate on
--    exactly the same rows even if something else writes concurrently.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _legacy_events ON COMMIT DROP AS
SELECT
    e.id,
    e.event_key,
    e.event_type,
    e.status,
    e.learner_id,
    e.learner_email,
    e.owner_email,
    e.target_date,
    e.scheduled_date,
    e.review_template_id,
    e.review_instance_id,
    e.graph_event_id,
    e.graph_web_link,
    e.graph_organizer_email,
    e.meeting_link,
    e.created_at
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr', 'progress-review')
  AND NULLIF(BTRIM(e.review_template_id), '') IS NULL
  AND NULLIF(BTRIM(e.review_instance_id),  '') IS NULL;

CREATE INDEX ON _legacy_events (id);

-- ---------------------------------------------------------------------------
-- 2. Count. Expected: mcr = 11, progress-review = 12, total = 23.
-- ---------------------------------------------------------------------------
SELECT 'legacy candidates by type' AS report, event_type, status, count(*) AS rows
FROM _legacy_events
GROUP BY event_type, status
ORDER BY event_type, status;

SELECT 'legacy candidates total' AS report, count(*) AS rows FROM _legacy_events;

-- ---------------------------------------------------------------------------
-- 3. The rows themselves, for the record. This is what is about to go.
-- ---------------------------------------------------------------------------
SELECT 'rows to delete' AS report, *
FROM _legacy_events
ORDER BY event_type, learner_id, target_date;

-- ---------------------------------------------------------------------------
-- 4. GRAPH / TEAMS REPORT -- read this before committing.
--    These meetings live in Microsoft, not here. This script does not call
--    Graph, so any row listed below leaves its Teams meeting in the
--    organiser's and attendees' calendars after the database row is gone.
-- ---------------------------------------------------------------------------
SELECT
    'graph/teams meetings left behind' AS report,
    l.id,
    l.event_key,
    l.event_type,
    l.status,
    l.learner_email,
    COALESCE(NULLIF(BTRIM(l.graph_organizer_email), ''), l.owner_email) AS graph_mailbox,
    l.graph_event_id,
    l.graph_web_link,
    l.meeting_link
FROM _legacy_events l
WHERE NULLIF(BTRIM(l.graph_event_id), '') IS NOT NULL
   OR NULLIF(BTRIM(l.graph_web_link), '')  IS NOT NULL
   OR NULLIF(BTRIM(l.meeting_link), '')    IS NOT NULL
ORDER BY l.event_type, l.target_date;

SELECT
    'graph summary' AS report,
    count(*)                                                                AS legacy_rows,
    count(*) FILTER (WHERE NULLIF(BTRIM(graph_event_id), '') IS NOT NULL)   AS with_graph_event_id,
    count(*) FILTER (WHERE NULLIF(BTRIM(meeting_link), '')   IS NOT NULL)   AS with_meeting_link
FROM _legacy_events;

-- ---------------------------------------------------------------------------
-- 5. Dependency counts, BEFORE deleting anything.
-- ---------------------------------------------------------------------------
SELECT '"Coach".coach_meeting_artifacts' AS relation, count(*) AS rows_to_delete
FROM "Coach".coach_meeting_artifacts a
WHERE a.calendar_event_id IN (SELECT id FROM _legacy_events)
   OR a.event_key         IN (SELECT event_key FROM _legacy_events)
UNION ALL
SELECT '"Coach".coach_meeting_attendance', count(*)
FROM "Coach".coach_meeting_attendance m
WHERE m.calendar_event_id IN (SELECT id FROM _legacy_events)
   OR m.event_key         IN (SELECT event_key FROM _legacy_events)
UNION ALL
SELECT '"Coach".coach_meeting_attendance_reports', count(*)
FROM "Coach".coach_meeting_attendance_reports r
WHERE r.calendar_event_id IN (SELECT id FROM _legacy_events)
   OR r.event_key         IN (SELECT event_key FROM _legacy_events)
UNION ALL
SELECT '"Coach".coach_meeting_summaries', count(*)
FROM "Coach".coach_meeting_summaries s
WHERE s.calendar_event_id IN (SELECT id FROM _legacy_events)
   OR s.event_key         IN (SELECT event_key FROM _legacy_events)
UNION ALL
SELECT '"Coach".coach_calendar_event', count(*) FROM _legacy_events;

-- ---------------------------------------------------------------------------
-- 6. PROGRESS REVIEW HISTORY -- REPORTED, NOT DELETED.
--    "Learner".progress_review_runs is keyed on (learner_kind, learner_id,
--    review_date). It carries no event_key and no calendar_event_id, so a run
--    CANNOT be proven to belong to one of these 23 calendar rows. Matching by
--    learner and date would be guessing, and the brief forbids that.
--    This lists what exists for the affected learners so you can see exactly
--    what is being kept.
-- ---------------------------------------------------------------------------
SELECT
    'progress review history KEPT (not provably linked)' AS report,
    r.id            AS run_id,
    r.learner_kind,
    r.learner_id,
    r.review_number,
    r.review_date,
    r.generation_status,
    r.generated_at,
    (SELECT count(*) FROM "Learner"."progress_review_pptx_files"       f WHERE f.run_id = r.id) AS pptx_files,
    (SELECT count(*) FROM "Learner"."progress_review_source_snapshots" x WHERE x.run_id = r.id) AS snapshots
FROM "Learner"."progress_review_runs" r
WHERE r.learner_id IN (SELECT DISTINCT learner_id FROM _legacy_events)
ORDER BY r.learner_id, r.review_date;

-- ---------------------------------------------------------------------------
-- 7. BACKUP. Created here if it does not already exist, so the rows cannot be
--    lost even if the separate backup step was skipped. If the table already
--    exists its contents are left exactly as they are, and G5 then checks it
--    covers all 23 ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Coach".legacy_review_calendar_backup_20260913 AS
SELECT e.*
FROM "Coach".coach_calendar_event e
WHERE e.id IN (SELECT id FROM _legacy_events);

SELECT 'backup table contents' AS report, count(*) AS rows
FROM "Coach".legacy_review_calendar_backup_20260913;

-- ---------------------------------------------------------------------------
-- 8. GUARDS. Nothing below this block runs unless all five pass.
-- ---------------------------------------------------------------------------
DO $guards$
DECLARE
    candidate_count  integer;
    bad_template     integer;
    bad_instance     integer;
    linked_instances integer;
    backed_up        integer;
BEGIN
    SELECT count(*) INTO candidate_count FROM _legacy_events;

    -- G1 -- the set must be exactly the 23 rows the audit found.
    IF candidate_count <> 23 THEN
        RAISE EXCEPTION
            'ABORT G1: expected exactly 23 legacy rows, found %. The database has changed since the audit -- re-run file A before proceeding.',
            candidate_count;
    END IF;

    -- G2 / G3 -- belt and braces. The WHERE clause already excludes these,
    -- so a hit here means the set was built wrong.
    SELECT count(*) INTO bad_template
    FROM _legacy_events WHERE NULLIF(BTRIM(review_template_id), '') IS NOT NULL;
    IF bad_template > 0 THEN
        RAISE EXCEPTION 'ABORT G2: % candidate(s) carry a review_template_id. These belong to the new architecture.', bad_template;
    END IF;

    SELECT count(*) INTO bad_instance
    FROM _legacy_events WHERE NULLIF(BTRIM(review_instance_id), '') IS NOT NULL;
    IF bad_instance > 0 THEN
        RAISE EXCEPTION 'ABORT G3: % candidate(s) carry a review_instance_id. These belong to the new architecture.', bad_instance;
    END IF;

    -- G4 -- the link is bidirectional and NOT enforced by a foreign key:
    -- review_instances.calendar_event_id can point at a row whose own
    -- review_instance_id is blank. Deleting such a row would leave a dangling
    -- pointer inside the new architecture, so stop and let a human look.
    SELECT count(*) INTO linked_instances
    FROM curriculum.review_instances i
    WHERE i.calendar_event_id IN (SELECT id FROM _legacy_events);
    IF linked_instances > 0 THEN
        RAISE EXCEPTION
            'ABORT G4: % curriculum.review_instance(s) point at a candidate via calendar_event_id. Investigate before deleting -- the new architecture must not be touched.',
            linked_instances;
    END IF;

    -- G5 -- every candidate must be in the backup table first.
    SELECT count(*) INTO backed_up
    FROM _legacy_events l
    WHERE EXISTS (
        SELECT 1 FROM "Coach".legacy_review_calendar_backup_20260913 b WHERE b.id = l.id
    );
    IF backed_up <> candidate_count THEN
        RAISE EXCEPTION
            'ABORT G5: backup holds % of % candidate rows. Refusing to delete unbacked rows.',
            backed_up, candidate_count;
    END IF;

    RAISE NOTICE 'All guards passed: % legacy rows, all backed up, no Curriculum linkage.', candidate_count;
END
$guards$;

-- ---------------------------------------------------------------------------
-- 9. DELETE the local meeting data owned exclusively by these events.
--    Matched on BOTH calendar_event_id AND event_key: the four tables carry
--    both columns, and an older row may have been written with only one.
--    Children before parents.
-- ---------------------------------------------------------------------------
DELETE FROM "Coach".coach_meeting_attendance
WHERE calendar_event_id IN (SELECT id FROM _legacy_events)
   OR event_key         IN (SELECT event_key FROM _legacy_events);

DELETE FROM "Coach".coach_meeting_attendance_reports
WHERE calendar_event_id IN (SELECT id FROM _legacy_events)
   OR event_key         IN (SELECT event_key FROM _legacy_events);

DELETE FROM "Coach".coach_meeting_artifacts
WHERE calendar_event_id IN (SELECT id FROM _legacy_events)
   OR event_key         IN (SELECT event_key FROM _legacy_events);

DELETE FROM "Coach".coach_meeting_summaries
WHERE calendar_event_id IN (SELECT id FROM _legacy_events)
   OR event_key         IN (SELECT event_key FROM _legacy_events);

-- ---------------------------------------------------------------------------
-- 10. DELETE the 23 legacy calendar rows.
-- ---------------------------------------------------------------------------
DELETE FROM "Coach".coach_calendar_event
WHERE id IN (SELECT id FROM _legacy_events);

-- ---------------------------------------------------------------------------
-- 11. VERIFICATION -- all still inside the transaction.
-- ---------------------------------------------------------------------------

-- V1. The brief's own check. EXPECTED: zero rows returned.
SELECT event_type, COUNT(*) AS remaining
FROM "Coach".coach_calendar_event
WHERE event_type IN ('mcr','progress-review')
  AND NULLIF(BTRIM(review_template_id),'') IS NULL
  AND NULLIF(BTRIM(review_instance_id),'') IS NULL
GROUP BY event_type;

-- V2. Nothing in the legacy set survives. EXPECTED: 0.
SELECT 'legacy rows surviving' AS check_name, count(*) AS value
FROM "Coach".coach_calendar_event e
WHERE e.id IN (SELECT id FROM _legacy_events);

-- V3. The new architecture is untouched. These counts must match what file A
--     reported before the cleanup.
SELECT 'curriculum.review_types'              AS relation, count(*) AS rows FROM curriculum.review_types
UNION ALL SELECT 'curriculum.review_templates',          count(*) FROM curriculum.review_templates
UNION ALL SELECT 'curriculum.review_instances',          count(*) FROM curriculum.review_instances
UNION ALL SELECT 'curriculum.review_instance_answers',   count(*) FROM curriculum.review_instance_answers
UNION ALL SELECT 'curriculum.review_instance_signatures',count(*) FROM curriculum.review_instance_signatures
UNION ALL SELECT 'progress_review_runs',                 count(*) FROM "Learner"."progress_review_runs"
UNION ALL SELECT 'progress_review_pptx_files',           count(*) FROM "Learner"."progress_review_pptx_files"
UNION ALL SELECT 'progress_review_source_snapshots',     count(*) FROM "Learner"."progress_review_source_snapshots";

-- V4. Coach review rows that remain, and their linkage. Every surviving
--     mcr / progress-review / review row should carry a review_template_id.
SELECT e.event_type,
       count(*)                                                                AS rows,
       count(*) FILTER (WHERE NULLIF(BTRIM(e.review_template_id),'') IS NOT NULL) AS with_template_link,
       count(*) FILTER (WHERE NULLIF(BTRIM(e.review_instance_id),'')  IS NOT NULL) AS with_instance_link
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr','progress-review','review')
GROUP BY e.event_type
ORDER BY e.event_type;

-- V5. No meeting row was orphaned by the deletes. EXPECTED: 0, 0, 0, 0.
SELECT 'orphan artifacts'          AS check_name, count(*) AS value
FROM "Coach".coach_meeting_artifacts a
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = a.event_key)
UNION ALL
SELECT 'orphan attendance', count(*)
FROM "Coach".coach_meeting_attendance m
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = m.event_key)
UNION ALL
SELECT 'orphan attendance reports', count(*)
FROM "Coach".coach_meeting_attendance_reports r
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = r.event_key)
UNION ALL
SELECT 'orphan summaries', count(*)
FROM "Coach".coach_meeting_summaries s
WHERE NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.event_key = s.event_key);

-- V6. No review instance was left pointing at a deleted calendar row.
--     EXPECTED: 0.
SELECT 'review_instances with a dangling calendar_event_id' AS check_name, count(*) AS value
FROM curriculum.review_instances i
WHERE i.calendar_event_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Coach".coach_calendar_event e WHERE e.id = i.calendar_event_id);

-- V7. The backup is intact and still holds all 23. EXPECTED: 23.
SELECT 'backup rows retained' AS check_name, count(*) AS value
FROM "Coach".legacy_review_calendar_backup_20260913;

COMMIT;

-- ============================================================================
-- AFTER COMMIT
--
-- 1. NOTHING NEEDS REGENERATING. The Curriculum engine does not persist
--    occurrences: resolve_learner_occurrences recomputes them in memory on
--    every calendar read, from
--        curriculum.review_types
--      + curriculum.review_templates (recurrence_interval / recurrence_unit)
--      + enrolment."Created_users"."Start_date"
--    A row only ever appears in coach_calendar_event once somebody schedules
--    or books one. Deleting the 23 removed history, not schedule. Do NOT
--    write generated occurrences back into the table to "restore" anything.
--
-- 2. Confirm the engine still produces MCM and PR by opening the coach
--    timetable and the learner calendar for a learner on a programme that has
--    an enabled template of each system type. Unbooked occurrences should
--    appear as "Not Scheduled" at the template's own cadence, counted from
--    the learner's own Created_users."Start_date".
--
-- 3. MICROSOFT GRAPH / TEAMS: any meeting listed by section 4 still exists in
--    Microsoft. This script never called Graph. The application deletes those
--    through delete_calendar_event_from_graph(record), which needs the row's
--    graph_organizer_email (or owner_email) and graph_event_id -- both are
--    preserved in the backup table, so they can still be cancelled later:
--
--      SELECT id, event_key,
--             COALESCE(NULLIF(BTRIM(graph_organizer_email), ''), owner_email) AS mailbox,
--             graph_event_id
--      FROM "Coach".legacy_review_calendar_backup_20260913
--      WHERE NULLIF(BTRIM(graph_event_id), '') IS NOT NULL;
--
--    Cancelling them is a separate, explicitly-instructed task.
--
-- 4. KEEP THE BACKUP until you are satisfied. It is the only copy.
-- ============================================================================
