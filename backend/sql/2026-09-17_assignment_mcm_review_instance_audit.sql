-- READ ONLY: comprehensive Assignment MCM / Review Instance consistency audit.
--
-- Purpose:
--   1. Find every MCM referenced by a saved monthly assignment (meetingKey),
--      plus direct assignment bookings identified by their server-written note.
--   2. Verify Calendar -> Review Instance linkage, identity and lifecycle status.
--   3. Audit every Review Instance in both directions, not only assignment MCMs.
--   4. Find saved assignment meetingKeys that no longer resolve to an MCM.
--
-- This file contains SELECT statements only. It changes no database data and
-- makes no Microsoft Graph / Teams calls. It includes learner names/emails so
-- the owner can classify real and test records; treat its output as sensitive.

-- ---------------------------------------------------------------------------
-- 1. Every Assignment-linked MCM, with one machine-readable verdict per row.
--
-- ERROR_STATUS_MISMATCH includes the original incident shape:
-- calendar_status='scheduled', instance_status='not-scheduled'. Advanced
-- statuses are expected to match exactly on both rows.
-- WARN_TARGET_DATE_DIFF is separate because approved legacy reconciliations
-- intentionally keep the old calendar target while the instance stores the
-- canonical Curriculum target.
-- ---------------------------------------------------------------------------
WITH assignment_refs AS (
    SELECT
        s.id::text AS submission_id,
        s.status AS assignment_status,
        NULLIF(BTRIM(s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') AS event_key,
        NULLIF(BTRIM(s.full_submission #>> '{monthlyAssignment,month}'), '') AS assignment_month
    FROM "Learner".learning_reflection_submissions s
    WHERE LOWER(BTRIM(s.activity_type)) = 'assignment'
      AND NULLIF(BTRIM(s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') IS NOT NULL
), assignment_events AS (
    SELECT
        e.*,
        refs.assignment_reference_count,
        refs.assignment_months,
        (refs.assignment_reference_count > 0) AS referenced_by_saved_assignment,
        (e.notes LIKE 'Monthly assignment:%') AS booked_from_assignment_flow
    FROM "Coach".coach_calendar_event e
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*)::integer AS assignment_reference_count,
            ARRAY_AGG(DISTINCT r.assignment_month ORDER BY r.assignment_month)
                FILTER (WHERE r.assignment_month IS NOT NULL) AS assignment_months
        FROM assignment_refs r
        WHERE r.event_key = e.event_key
    ) refs ON TRUE
    WHERE e.event_type = 'mcr'
      AND (refs.assignment_reference_count > 0 OR e.notes LIKE 'Monthly assignment:%')
), audited AS (
    SELECT
        e.id AS calendar_id,
        e.learner_id,
        e.learner_name,
        e.learner_email,
        e.event_key,
        e.referenced_by_saved_assignment,
        e.booked_from_assignment_flow,
        e.assignment_reference_count,
        e.assignment_months,
        e.status AS calendar_status,
        e.sync_state,
        e.target_date AS calendar_target_date,
        e.scheduled_date,
        e.scheduled_time,
        e.occurrence_number AS calendar_occurrence,
        NULLIF(BTRIM(e.review_template_id), '') AS calendar_template_id,
        NULLIF(BTRIM(e.review_instance_id), '') AS calendar_instance_id,
        i.id AS instance_id,
        i.status AS instance_status,
        i.target_date AS instance_target_date,
        i.occurrence_number AS instance_occurrence,
        i.calendar_event_id AS instance_calendar_id,
        rt.code AS review_type_code,
        (i.id IS NOT NULL AND i.calendar_event_id = e.id) AS backlink_matches,
        (i.id IS NOT NULL AND i.learner_id = e.learner_id) AS learner_matches,
        (i.id IS NOT NULL AND i.review_template_id = e.review_template_id) AS template_matches,
        (i.id IS NOT NULL AND i.occurrence_number IS NOT DISTINCT FROM e.occurrence_number)
            AS occurrence_matches,
        (i.id IS NOT NULL AND LOWER(BTRIM(i.coach_email)) = LOWER(BTRIM(e.owner_email)))
            AS coach_matches,
        (i.id IS NOT NULL AND i.status = e.status) AS status_matches,
        (i.id IS NOT NULL AND i.target_date = e.target_date) AS target_date_matches,
        (SELECT COUNT(*)
           FROM "Coach".coach_calendar_event other
          WHERE NULLIF(BTRIM(other.review_instance_id), '') = NULLIF(BTRIM(e.review_instance_id), ''))
            AS calendars_using_instance,
        CASE
            WHEN NULLIF(BTRIM(e.review_template_id), '') IS NULL
              OR NULLIF(BTRIM(e.review_instance_id), '') IS NULL
                THEN 'ERROR_MISSING_CALENDAR_LINKAGE'
            WHEN i.id IS NULL THEN 'ERROR_INSTANCE_NOT_FOUND'
            WHEN i.calendar_event_id IS DISTINCT FROM e.id THEN 'ERROR_BACKLINK_MISMATCH'
            WHEN i.learner_id IS DISTINCT FROM e.learner_id THEN 'ERROR_LEARNER_MISMATCH'
            WHEN i.review_template_id IS DISTINCT FROM e.review_template_id THEN 'ERROR_TEMPLATE_MISMATCH'
            WHEN i.occurrence_number IS DISTINCT FROM e.occurrence_number THEN 'ERROR_OCCURRENCE_MISMATCH'
            WHEN LOWER(BTRIM(i.coach_email)) IS DISTINCT FROM LOWER(BTRIM(e.owner_email))
                THEN 'ERROR_COACH_MISMATCH'
            WHEN rt.code IS DISTINCT FROM 'mcm' THEN 'ERROR_NOT_MCM_TEMPLATE'
            WHEN i.status IS DISTINCT FROM e.status THEN 'ERROR_STATUS_MISMATCH'
            WHEN e.status IN ('scheduled', 'in-progress', 'awaiting-signature', 'completed')
             AND (e.scheduled_date IS NULL OR e.scheduled_time IS NULL)
                THEN 'ERROR_ACTIVE_WITHOUT_SCHEDULE'
            WHEN (SELECT COUNT(*)
                    FROM "Coach".coach_calendar_event other
                   WHERE NULLIF(BTRIM(other.review_instance_id), '') =
                         NULLIF(BTRIM(e.review_instance_id), '')) > 1
                THEN 'ERROR_INSTANCE_USED_BY_MULTIPLE_CALENDARS'
            WHEN i.target_date IS DISTINCT FROM e.target_date THEN 'WARN_TARGET_DATE_DIFF'
            WHEN e.sync_state IN ('failed', 'reconciliation') THEN 'WARN_TEAMS_SYNC'
            WHEN e.status IN ('scheduled', 'in-progress')
             AND NULLIF(BTRIM(e.meeting_link), '') IS NULL
                THEN 'WARN_ACTIVE_WITHOUT_JOIN_LINK'
            ELSE 'OK'
        END AS check_result
    FROM assignment_events e
    LEFT JOIN curriculum.review_instances i
      ON i.id = NULLIF(BTRIM(e.review_instance_id), '')
    LEFT JOIN curriculum.review_templates t
      ON t.id = i.review_template_id
    LEFT JOIN curriculum.review_types rt
      ON rt.id = t.review_type_id
)
SELECT
    *,
    COUNT(*) OVER (PARTITION BY check_result) AS rows_with_same_result
FROM audited
ORDER BY
    CASE WHEN check_result = 'OK' THEN 2
         WHEN check_result LIKE 'WARN_%' THEN 1
         ELSE 0 END,
    calendar_id;

-- ---------------------------------------------------------------------------
-- 2. Status-pair distribution for every linked review calendar row.
-- Any pair where status_matches=false requires investigation. This catches
-- all review types, including MCM, Progress Review and custom Reviews.
-- ---------------------------------------------------------------------------
SELECT
    e.event_type,
    e.status AS calendar_status,
    i.status AS instance_status,
    (e.status = i.status) AS status_matches,
    COUNT(*) AS rows,
    ARRAY_AGG(e.id ORDER BY e.id) AS calendar_ids,
    ARRAY_AGG(e.learner_name ORDER BY e.id) AS learner_names,
    ARRAY_AGG(e.learner_email ORDER BY e.id) AS learner_emails
FROM "Coach".coach_calendar_event e
JOIN curriculum.review_instances i
  ON i.id = NULLIF(BTRIM(e.review_instance_id), '')
WHERE NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
GROUP BY e.event_type, e.status, i.status
ORDER BY status_matches, e.event_type, e.status, i.status;

-- ---------------------------------------------------------------------------
-- 3. Calendar -> Instance anomalies for every review-driven calendar row.
-- A clean result is an empty result set.
-- ---------------------------------------------------------------------------
WITH calendar_audit AS (
    SELECT
        e.id AS calendar_id,
        e.event_type,
        e.event_key,
        e.learner_id,
        e.learner_name,
        e.learner_email,
        e.status AS calendar_status,
        e.sync_state,
        e.scheduled_date,
        e.scheduled_time,
        NULLIF(BTRIM(e.review_template_id), '') AS calendar_template_id,
        NULLIF(BTRIM(e.review_instance_id), '') AS calendar_instance_id,
        i.id AS instance_id,
        i.status AS instance_status,
        i.calendar_event_id AS instance_calendar_id,
        CASE
            WHEN NULLIF(BTRIM(e.review_template_id), '') IS NULL
              OR NULLIF(BTRIM(e.review_instance_id), '') IS NULL
                THEN 'ERROR_MISSING_CALENDAR_LINKAGE'
            WHEN i.id IS NULL THEN 'ERROR_INSTANCE_NOT_FOUND'
            WHEN i.calendar_event_id IS DISTINCT FROM e.id THEN 'ERROR_BACKLINK_MISMATCH'
            WHEN i.learner_id IS DISTINCT FROM e.learner_id THEN 'ERROR_LEARNER_MISMATCH'
            WHEN i.review_template_id IS DISTINCT FROM e.review_template_id THEN 'ERROR_TEMPLATE_MISMATCH'
            WHEN i.occurrence_number IS DISTINCT FROM e.occurrence_number THEN 'ERROR_OCCURRENCE_MISMATCH'
            WHEN LOWER(BTRIM(i.coach_email)) IS DISTINCT FROM LOWER(BTRIM(e.owner_email))
                THEN 'ERROR_COACH_MISMATCH'
            WHEN i.status IS DISTINCT FROM e.status THEN 'ERROR_STATUS_MISMATCH'
            WHEN e.status IN ('scheduled', 'in-progress', 'awaiting-signature', 'completed')
             AND (e.scheduled_date IS NULL OR e.scheduled_time IS NULL)
                THEN 'ERROR_ACTIVE_WITHOUT_SCHEDULE'
            WHEN (SELECT COUNT(*)
                    FROM "Coach".coach_calendar_event other
                   WHERE NULLIF(BTRIM(other.review_instance_id), '') =
                         NULLIF(BTRIM(e.review_instance_id), '')) > 1
                THEN 'ERROR_INSTANCE_USED_BY_MULTIPLE_CALENDARS'
            ELSE 'OK'
        END AS check_result
    FROM "Coach".coach_calendar_event e
    LEFT JOIN curriculum.review_instances i
      ON i.id = NULLIF(BTRIM(e.review_instance_id), '')
    WHERE e.event_type IN ('mcr', 'progress-review', 'review')
       OR NULLIF(BTRIM(e.review_template_id), '') IS NOT NULL
       OR NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
)
SELECT *
FROM calendar_audit
WHERE check_result <> 'OK'
ORDER BY check_result, calendar_id;

-- ---------------------------------------------------------------------------
-- 4. Instance -> Calendar anomalies, including active orphan instances.
-- A not-scheduled instance with no calendar_event_id is a valid unbooked
-- occurrence. Every other missing/dangling/mismatched relationship is bad.
-- ---------------------------------------------------------------------------
WITH instance_audit AS (
    SELECT
        i.id AS instance_id,
        i.learner_id,
        COALESCE(e.learner_name, p.full_name) AS learner_name,
        COALESCE(e.learner_email, p.email) AS learner_email,
        i.review_template_id,
        i.occurrence_number,
        i.target_date,
        i.status AS instance_status,
        i.calendar_event_id,
        e.id AS calendar_id,
        e.event_type,
        e.event_key,
        e.status AS calendar_status,
        CASE
            WHEN i.calendar_event_id IS NULL AND i.status = 'not-scheduled'
                THEN 'OK_UNBOOKED'
            WHEN i.calendar_event_id IS NULL
                THEN 'ERROR_ACTIVE_INSTANCE_WITHOUT_CALENDAR'
            WHEN e.id IS NULL THEN 'ERROR_DANGLING_CALENDAR_BACKLINK'
            WHEN NULLIF(BTRIM(e.review_instance_id), '') IS DISTINCT FROM i.id
                THEN 'ERROR_CALENDAR_FORWARD_LINK_MISMATCH'
            WHEN e.learner_id IS DISTINCT FROM i.learner_id THEN 'ERROR_LEARNER_MISMATCH'
            WHEN e.review_template_id IS DISTINCT FROM i.review_template_id THEN 'ERROR_TEMPLATE_MISMATCH'
            WHEN e.occurrence_number IS DISTINCT FROM i.occurrence_number THEN 'ERROR_OCCURRENCE_MISMATCH'
            WHEN LOWER(BTRIM(e.owner_email)) IS DISTINCT FROM LOWER(BTRIM(i.coach_email))
                THEN 'ERROR_COACH_MISMATCH'
            WHEN e.status IS DISTINCT FROM i.status THEN 'ERROR_STATUS_MISMATCH'
            ELSE 'OK'
        END AS check_result
    FROM curriculum.review_instances i
    LEFT JOIN "Coach".coach_calendar_event e
      ON e.id = i.calendar_event_id
    LEFT JOIN "Learner".learners p
      ON p.id = i.learner_id
)
SELECT *
FROM instance_audit
WHERE check_result NOT IN ('OK', 'OK_UNBOOKED')
ORDER BY check_result, instance_id;

-- ---------------------------------------------------------------------------
-- 5. Saved assignment meetingKeys that no longer resolve to an MCM.
-- A clean result is an empty result set.
-- ---------------------------------------------------------------------------
SELECT
    s.id AS submission_id,
    s.learner_kind,
    s.learner_id,
    COALESCE(NULLIF(BTRIM(s.learner_name), ''), u."Username") AS learner_name,
    u."Email" AS learner_email,
    s.status AS assignment_status,
    s.activity_id,
    s.full_submission #>> '{monthlyAssignment,month}' AS assignment_month,
    s.full_submission #>> '{monthlyAssignment,meetingKey}' AS meeting_key,
    e.id AS calendar_id,
    e.learner_id AS referenced_calendar_learner_id,
    e.event_type,
    e.status AS calendar_status,
    CASE
        WHEN s.learner_id::text IN ('499') THEN 'CONFIRMED_TEST'
        WHEN s.learner_id::text IN ('248', '647') THEN 'TEST_CANDIDATE'
        ELSE 'REAL'
    END AS data_classification,
    CASE
        WHEN e.id IS NULL THEN 'ERROR_ASSIGNMENT_MEETING_MISSING'
        WHEN e.event_type <> 'mcr' THEN 'ERROR_ASSIGNMENT_MEETING_NOT_MCM'
        ELSE 'OK'
    END AS check_result,
    CASE
        WHEN e.id IS NULL OR e.event_type <> 'mcr'
            THEN 'KEEP_SUBMISSION_CLEAR_STALE_MEETING_KEY'
        ELSE 'KEEP'
    END AS recommended_action
FROM "Learner".learning_reflection_submissions s
LEFT JOIN "Coach".coach_calendar_event e
  ON e.event_key = NULLIF(BTRIM(s.full_submission #>> '{monthlyAssignment,meetingKey}'), '')
LEFT JOIN enrolment."Created_users" u
  ON u.id::text = BTRIM(s.learner_id)
WHERE LOWER(BTRIM(s.activity_type)) = 'assignment'
  AND NULLIF(BTRIM(s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') IS NOT NULL
  AND (e.id IS NULL OR e.event_type <> 'mcr')
ORDER BY check_result, s.id;
