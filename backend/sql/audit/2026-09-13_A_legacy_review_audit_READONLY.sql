-- ============================================================================
-- A. AUDIT ONLY -- SELECT statements. Nothing is written.
--
-- Legacy MCM / Progress Review data audit, for the move to the Curriculum
-- Review architecture (curriculum.review_types -> review_templates ->
-- review_type_id -> learner start date -> recurrence -> occurrences).
--
-- Safe to run on production Neon. Every statement is read-only.
-- Written for the Neon Web SQL Editor: plain SQL only, no psql
-- meta-commands. The editor returns one result grid per statement, so run a
-- single numbered block at a time when you want to read it closely.
-- ============================================================================

-- === 0. Which legacy relations still exist at all ===
SELECT n.nspname AS schema, c.relname AS relation, c.reltuples::bigint AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND (
    (n.nspname = 'public'     AND c.relname IN ('MCR', 'progress_review'))
 OR (n.nspname = 'curriculum' AND c.relname IN ('review_types','review_templates','review_instances',
                                                'review_instance_answers','review_instance_signatures',
                                                'review_occurrence_overrides','review_clash_resolutions'))
 OR (n.nspname = 'Coach'      AND c.relname IN ('coach_calendar_event','coach_meeting_artifacts',
                                                'coach_meeting_attendance','coach_meeting_attendance_reports',
                                                'coach_meeting_summaries'))
 OR (n.nspname = 'Learner'    AND c.relname IN ('progress_review_runs','progress_review_source_snapshots',
                                                'progress_review_pptx_files'))
  )
ORDER BY schema, relation;

-- === 1. Legacy configuration: coach_surface still populated? ===
-- coach_surface is dormant: no runtime code reads it after the
-- 2026-09-13 review-types migration. This shows whether the backfill
-- into review_type_id covered every row that had one.
SELECT
    coach_surface,
    review_type_id,
    count(*)                                          AS templates,
    count(*) FILTER (WHERE deleted_at IS NULL)        AS live_templates,
    count(*) FILTER (WHERE enabled)                   AS enabled_templates
FROM curriculum.review_templates
GROUP BY coach_surface, review_type_id
ORDER BY coach_surface NULLS FIRST, review_type_id NULLS FIRST;

-- === 1b. Templates the backfill did NOT classify (coach_surface set, type null) ===
SELECT id, programme_id, name, coach_surface, review_type_id, enabled, deleted_at, created_at, updated_at
FROM curriculum.review_templates
WHERE coach_surface IS NOT NULL
  AND (review_type_id IS NULL OR review_type_id = '')
ORDER BY programme_id, created_at;

-- === 2. Review Type catalogue ===
SELECT id, name, code, is_system, is_active, created_by, created_at
FROM curriculum.review_types
ORDER BY is_system DESC, name;

-- === 3. Review Templates per programme, per type (duplicates / unclassified) ===
SELECT
    t.programme_id,
    coalesce(ty.code, '(none)')      AS review_type_code,
    coalesce(ty.name, '(unclassified)') AS review_type_name,
    count(*)                          AS templates,
    count(*) FILTER (WHERE t.enabled) AS enabled_templates,
    string_agg(t.id || ' :: ' || t.name || ' :: ' ||
               t.recurrence_interval || ' ' || t.recurrence_unit ||
               CASE WHEN t.enabled THEN '' ELSE ' [disabled]' END, E'\n' ORDER BY t.created_at) AS detail
FROM curriculum.review_templates t
LEFT JOIN curriculum.review_types ty ON ty.id = t.review_type_id
WHERE t.deleted_at IS NULL
GROUP BY t.programme_id, ty.code, ty.name
ORDER BY t.programme_id, review_type_code;

-- === 3b. Programmes with MORE THAN ONE enabled template of a system type ===
-- Not illegal, but it makes progress_reviews_api._interval and
-- review_instances.get_review_type_template ambiguous (they take the most
-- recently updated match).
SELECT t.programme_id, ty.code AS review_type_code, count(*) AS enabled_templates,
       string_agg(t.id || ' (' || t.name || ')', ', ' ORDER BY t.updated_at DESC) AS templates
FROM curriculum.review_templates t
JOIN curriculum.review_types ty ON ty.id = t.review_type_id
WHERE t.deleted_at IS NULL AND t.enabled AND ty.is_system
GROUP BY t.programme_id, ty.code
HAVING count(*) > 1
ORDER BY t.programme_id;

-- === 4. CoachCalendarEvent: review-driven rows by linkage and activity ===
SELECT
    e.event_type,
    e.status,
    (nullif(btrim(e.review_template_id), '') IS NOT NULL) AS has_template_link,
    (nullif(btrim(e.review_instance_id), '') IS NOT NULL) AS has_instance_link,
    count(*) AS rows,
    count(*) FILTER (WHERE nullif(btrim(e.graph_event_id), '') IS NOT NULL) AS with_graph_event,
    count(*) FILTER (WHERE nullif(btrim(e.meeting_link), '') IS NOT NULL)   AS with_meeting_link,
    count(*) FILTER (WHERE e.review_completed_at IS NOT NULL)               AS completed,
    count(*) FILTER (WHERE e.manager_signed_at IS NOT NULL)                 AS manager_signed,
    count(*) FILTER (WHERE e.review_responses <> '{}'::jsonb)               AS with_responses,
    min(e.created_at) AS earliest_created,
    max(e.created_at) AS latest_created
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr', 'progress-review', 'review')
GROUP BY e.event_type, e.status, has_template_link, has_instance_link
ORDER BY e.event_type, e.status, has_template_link, has_instance_link;

-- === 4b. Full row detail for review events MISSING the new linkage ===
-- CATEGORY B CANDIDATES. Old routing present, new Review linkage absent.
-- Do NOT delete these on the strength of this query alone.
SELECT
    e.id, e.event_key, e.learner_id, e.learner_email, e.owner_email AS coach_email,
    e.event_type, e.sequence, e.occurrence_number,
    e.target_date, e.scheduled_date, e.scheduled_time, e.status,
    e.review_template_id, e.review_instance_id,
    nullif(btrim(e.graph_event_id), '')  AS graph_event_id,
    nullif(btrim(e.meeting_link), '')    AS meeting_link,
    nullif(btrim(e.graph_web_link), '')  AS graph_web_link,
    e.review_completed_at, e.manager_signed_at,
    (e.review_responses <> '{}'::jsonb)  AS has_responses,
    nullif(btrim(e.notes), '')           AS notes,
    nullif(btrim(e.last_graph_sync_error), '') AS sync_error,
    e.sync_state, e.created_at, e.updated_at
FROM "Coach".coach_calendar_event e
WHERE e.event_type IN ('mcr', 'progress-review', 'review')
  AND (nullif(btrim(e.review_template_id), '') IS NULL
       OR nullif(btrim(e.review_instance_id), '') IS NULL)
ORDER BY e.event_type, e.learner_id, e.target_date;

-- === 4c. Review events that carry REAL activity (CATEGORY C -- never delete) ===
SELECT
    e.id, e.event_key, e.learner_id, e.event_type, e.status,
    e.target_date, e.scheduled_date,
    e.review_template_id, e.review_instance_id,
    (nullif(btrim(e.graph_event_id), '') IS NOT NULL) AS has_graph_event,
    (nullif(btrim(e.meeting_link), '')   IS NOT NULL) AS has_meeting_link,
    (e.review_responses <> '{}'::jsonb)               AS has_responses,
    (e.review_completed_at IS NOT NULL)               AS is_completed,
    (e.manager_signed_at   IS NOT NULL)               AS manager_signed,
    (nullif(btrim(e.notes), '') IS NOT NULL)          AS has_notes,
    art.artifacts, att.attendance_rows, summ.summaries
FROM "Coach".coach_calendar_event e
LEFT JOIN LATERAL (
    SELECT count(*) AS artifacts FROM "Coach".coach_meeting_artifacts a WHERE a.event_key = e.event_key
) art ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS attendance_rows FROM "Coach".coach_meeting_attendance m WHERE m.event_key = e.event_key
) att ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS summaries FROM "Coach".coach_meeting_summaries s WHERE s.event_key = e.event_key
) summ ON true
WHERE e.event_type IN ('mcr', 'progress-review', 'review')
  AND (
        e.status IN ('completed', 'in-progress', 'awaiting-signature')
     OR e.review_completed_at IS NOT NULL
     OR e.manager_signed_at   IS NOT NULL
     OR e.review_responses   <> '{}'::jsonb
     OR nullif(btrim(e.graph_event_id), '') IS NOT NULL
     OR nullif(btrim(e.meeting_link), '')   IS NOT NULL
     OR nullif(btrim(e.notes), '')          IS NOT NULL
     OR art.artifacts   > 0
     OR att.attendance_rows > 0
     OR summ.summaries  > 0
  )
ORDER BY e.event_type, e.learner_id, e.target_date;

-- === 5. Review instances: emptiness profile ===
SELECT
    i.status,
    (a.answers   > 0) AS has_answers,
    (s.signatures > 0) AS has_signatures,
    (i.calendar_event_id IS NOT NULL) AS linked_to_calendar,
    count(*) AS instances,
    min(i.created_at) AS earliest_created,
    max(i.created_at) AS latest_created
FROM curriculum.review_instances i
LEFT JOIN LATERAL (
    SELECT count(*) AS answers FROM curriculum.review_instance_answers x WHERE x.review_instance_id = i.id
) a ON true
LEFT JOIN LATERAL (
    SELECT count(*) AS signatures FROM curriculum.review_instance_signatures x WHERE x.review_instance_id = i.id
) s ON true
GROUP BY i.status, has_answers, has_signatures, linked_to_calendar
ORDER BY i.status;

-- === 5b. Orphan / empty review instances (CATEGORY F candidates) ===
SELECT
    i.id, i.review_template_id, i.learner_id, i.programme_id,
    i.occurrence_number, i.target_date, i.status,
    i.calendar_event_id, i.started_at, i.completed_at,
    i.created_by, i.created_at,
    (t.id IS NULL)                       AS template_missing,
    (ce.id IS NULL)                      AS calendar_row_missing
FROM curriculum.review_instances i
LEFT JOIN curriculum.review_templates t  ON t.id  = i.review_template_id
LEFT JOIN "Coach".coach_calendar_event ce ON ce.id = i.calendar_event_id
WHERE NOT EXISTS (SELECT 1 FROM curriculum.review_instance_answers    a WHERE a.review_instance_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM curriculum.review_instance_signatures s WHERE s.review_instance_id = i.id)
  AND i.completed_at IS NULL
  AND i.started_at   IS NULL
  AND coalesce(i.status, '') IN ('', 'not-scheduled')
ORDER BY i.created_at;

-- === 5c. Review instances whose template or calendar row has vanished ===
SELECT i.id, i.review_template_id, i.calendar_event_id, i.learner_id, i.target_date, i.status, i.created_at,
       (t.id IS NULL) AS template_missing, (ce.id IS NULL AND i.calendar_event_id IS NOT NULL) AS calendar_row_missing
FROM curriculum.review_instances i
LEFT JOIN curriculum.review_templates t   ON t.id  = i.review_template_id
LEFT JOIN "Coach".coach_calendar_event ce ON ce.id = i.calendar_event_id
WHERE t.id IS NULL OR (i.calendar_event_id IS NOT NULL AND ce.id IS NULL)
ORDER BY i.created_at;

-- === 6. Occurrence overrides / clash resolutions pointing at dead templates ===
SELECT 'review_occurrence_overrides' AS relation, o.id, o.review_id AS review_template_id,
       o.programme_id, o.learner_id, o.occurrence_date, o.action, o.deleted_at, o.created_at
FROM curriculum.review_occurrence_overrides o
LEFT JOIN curriculum.review_templates t ON t.id = o.review_id
WHERE t.id IS NULL
UNION ALL
SELECT 'review_clash_resolutions', c.id, NULL, c.programme_id, NULL, NULL, c.resolution, c.deleted_at, c.created_at
FROM curriculum.review_clash_resolutions c
WHERE NOT EXISTS (SELECT 1 FROM curriculum.review_templates t WHERE t.programme_id = c.programme_id)
ORDER BY created_at;

-- === 7. Progress Review packs / runs (CATEGORY C -- historical output) ===
SELECT r.generation_status, count(*) AS runs,
       count(*) FILTER (WHERE p.files > 0) AS runs_with_pptx,
       count(*) FILTER (WHERE s.snapshots > 0) AS runs_with_snapshot,
       min(r.created_at) AS earliest, max(r.created_at) AS latest
FROM "Learner"."progress_review_runs" r
LEFT JOIN LATERAL (SELECT count(*) AS files FROM "Learner"."progress_review_pptx_files" f WHERE f.run_id = r.id) p ON true
LEFT JOIN LATERAL (SELECT count(*) AS snapshots FROM "Learner"."progress_review_source_snapshots" x WHERE x.run_id = r.id) s ON true
GROUP BY r.generation_status
ORDER BY r.generation_status;

-- === 8. Start-date provenance: what can and cannot be proved ===
-- There is NO provenance column on enrolment."Created_users"."Start_date".
-- This only shows how many learners currently hold a start date equal to
-- their cohort's -- which is EVIDENCE, NOT PROOF, of the 2026-09-12 backfill.
-- A learner genuinely starting on their cohort's first day is indistinguishable.
SELECT
    count(*)                                                        AS commercial_delivery_learners,
    count(*) FILTER (WHERE nullif(btrim(u."Start_date"), '') IS NULL) AS no_start_date,
    count(*) FILTER (WHERE btrim(u."Start_date") = c.start_date::text) AS start_date_equals_cohort,
    count(*) FILTER (WHERE nullif(btrim(u."Start_date"), '') IS NOT NULL
                       AND btrim(u."Start_date") <> c.start_date::text) AS start_date_differs_from_cohort
FROM enrolment."Created_users" u
LEFT JOIN LATERAL (
    SELECT min(x.start_date) AS start_date
    FROM curriculum.cohorts x
    WHERE lower(btrim(x.programme_name)) = lower(btrim(u."Programme"))
      AND lower(btrim(x.cohort_name))    = lower(btrim(u."Cohort"))
    GROUP BY lower(btrim(x.programme_name)), lower(btrim(x.cohort_name))
    HAVING count(*) = 1
) c ON true
WHERE u."Learner_type" = 'commercial';

-- === 8b. Learners whose profile mirror disagrees with their own start date ===
-- "Learner".learners.start_date is stamped with the COHORT window by
-- active_users.mirror_learner_placement. A disagreement here is normal and is
-- NOT a defect -- it is why the Review engine reads Created_users."Start_date".
SELECT u.id AS enrolment_id, u."Programme", u."Cohort",
       btrim(u."Start_date") AS learner_own_start_date,
       l.start_date          AS profile_mirror_start_date
FROM enrolment."Created_users" u
JOIN "Learner".learners l ON l.enrolment_id = u.id
WHERE nullif(btrim(u."Start_date"), '') IS NOT NULL
  AND l.start_date IS NOT NULL
  AND btrim(u."Start_date") <> l.start_date::text
ORDER BY u."Programme", u."Cohort", u.id;

-- === 9. Migration boundary: rows created before/after 2026-09-13 ===
SELECT 'coach_calendar_event (review rows)' AS relation,
       count(*) FILTER (WHERE created_at <  DATE '2026-09-13') AS before_migration,
       count(*) FILTER (WHERE created_at >= DATE '2026-09-13') AS on_or_after
FROM "Coach".coach_calendar_event
WHERE event_type IN ('mcr', 'progress-review', 'review')
UNION ALL
SELECT 'curriculum.review_instances',
       count(*) FILTER (WHERE created_at <  DATE '2026-09-13'),
       count(*) FILTER (WHERE created_at >= DATE '2026-09-13')
FROM curriculum.review_instances
UNION ALL
SELECT 'curriculum.review_templates',
       count(*) FILTER (WHERE created_at <  DATE '2026-09-13'),
       count(*) FILTER (WHERE created_at >= DATE '2026-09-13')
FROM curriculum.review_templates;

-- === 10. Legacy import tables no production code reads any more ===
-- coach_api.views.fetch_timetable_source_rows / extract_mcr_events /
-- extract_progress_review_events are DEAD CODE (no callers). These are the
-- tables they read.
SELECT 'public."MCR"' AS relation, count(*) AS rows FROM public."MCR"
UNION ALL
SELECT 'public.progress_review', count(*) FROM public.progress_review;
