-- OWNER EXECUTES MANUALLY in the Neon SQL Editor. Do not run through Django.
-- Pilot: Mohamed Elmasry, Aptem 92 -> commercial enrolment 125, profile 272.
-- 31 original uploaded files across 14 classified Aptem components (run 4).
-- No curriculum/progress/hours/points changes. No invented answers or declarations.
-- Re-running skips existing rows; it never overwrites a draft or submission.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE "Learner".learning_reflection_submissions IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM enrolment."Created_users" u
      JOIN "LMS"."Aptem_users" a ON a."ID"::text = btrim(u.aptem_id)
      JOIN "Learner".learners l ON l.enrolment_id = u.id
      WHERE u.id = 125 AND a."ID" = 92 AND l.id = 272
        AND a."FullName" = 'Mohamed Elmasry'
        AND lower(btrim(u."Learner_type")) = 'commercial'
        AND nullif(lower(btrim(u."Email")), '') = lower(btrim(a."Email"))
        AND lower(btrim(l.email)) = lower(btrim(a."Email"))) <> 1 THEN
    RAISE EXCEPTION 'Elmasry identity does not match the reviewed pilot. Nothing imported.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fetching_evidence.assignment_classification_runs
                 WHERE id = 4 AND learner_id = 92 AND status = 'completed') THEN
    RAISE EXCEPTION 'Reviewed classification run 4 is unavailable.';
  END IF;
  IF (SELECT count(DISTINCT e.evidence_id)
      FROM fetching_evidence.assignment_classification_evaluations v
      JOIN fetching_evidence.evidence_items e
        ON e.learner_id = v.learner_id AND e.component_id = v.component_id
        AND (e.evidence_id = v.evidence_id OR v.source_evidence_ids @> to_jsonb(e.evidence_id))
      WHERE v.learner_id = 92 AND v.run_id = 4
        AND e.evidence_id IN (19852,19853,19855,19856,19857,20115,20116,20117,20118,
          20120,20121,20122,20123,20124,20125,20126,20127,20128,25475,25477,
          26148,29927,29928,29929,34553,48429,48430,52579,52928,53008,53009)
        AND nullif(e.file_blob, '') IS NOT NULL
        AND lower(e.evidence_status) = 'accepted' AND e.submission_date IS NOT NULL) <> 31 THEN
    RAISE EXCEPTION 'The 31 reviewed source files have changed or are incomplete. Nothing imported.';
  END IF;
END $guard$;

-- BEGIN READ-ONLY SOURCE
WITH source AS (
  SELECT DISTINCT ON (e.evidence_id)
    e.evidence_id, e.component_id, e.evidence_name, e.component_name,
    e.evidence_status, e.submission_date, e.completed_date,
    e.completed_date_override, e.file_blob, e.report_blob,
    e.spent_time, e.spent_time_type, e.hours_type, e.feedbacks,
    coalesce((e.completed_date_override AT TIME ZONE 'Europe/London')::date,
             (e.completed_date AT TIME ZONE 'Europe/London')::date,
             v.completed_date,
             (e.submission_date AT TIME ZONE 'Europe/London')::date) AS activity_date,
    'aptem:92:evidence:' || e.evidence_id::text AS activity_id,
    a."FullName" AS learner_name, a."Program Name" AS programme_name
  FROM fetching_evidence.assignment_classification_evaluations v
  JOIN fetching_evidence.evidence_items e
    ON e.learner_id = v.learner_id AND e.component_id = v.component_id
    AND (e.evidence_id = v.evidence_id OR v.source_evidence_ids @> to_jsonb(e.evidence_id))
  JOIN "LMS"."Aptem_users" a ON a."ID" = e.learner_id
  WHERE v.learner_id = 92 AND v.run_id = 4
    AND e.evidence_id IN (19852,19853,19855,19856,19857,20115,20116,20117,20118,
      20120,20121,20122,20123,20124,20125,20126,20127,20128,25475,25477,
      26148,29927,29928,29929,34553,48429,48430,52579,52928,53008,53009)
  ORDER BY e.evidence_id, v.id
)
-- END READ-ONLY SOURCE
INSERT INTO "Learner".learning_reflection_submissions (
  id, learner_kind, learner_id, enrolment_id, learner_name, programme_name,
  activity_type, activity_id, activity_title, module_title, status,
  learning_reflection, date_completed, submitted_at, full_submission
)
SELECT md5('elmasry-legacy-assignment-v1:' || evidence_id::text)::uuid,
       'commercial', '125', 125, learner_name, programme_name,
       'assignment', activity_id, evidence_name, component_name, 'accepted',
       '', activity_date, submission_date,
       jsonb_build_object(
         'learnerKind', 'commercial', 'learnerId', '125', 'learnerName', learner_name,
         'programmeName', programme_name, 'activityType', 'assignment',
         'activityId', activity_id, 'activityTitle', evidence_name,
         'moduleTitle', component_name, 'weekTitle', '',
         'dateCompleted', activity_date, 'submissionOrigin', 'imported_legacy',
         'assignmentAnswer', '', 'whatYouLearned', '', 'businessImpact', '',
         'monthlyAssignment', jsonb_build_object('version', 2, 'month', to_char(activity_date, 'YYYY-MM'), 'step', 0),
         'legacyAssignment', jsonb_build_object(
           'importBatch', 'elmasry-92-v1', 'runId', 4, 'aptemLearnerId', 92,
           'componentId', component_id, 'evidenceIds', jsonb_build_array(evidence_id),
           'sourceStatus', evidence_status, 'sourceSubmittedAt', submission_date,
           'sourceCompletedAt', completed_date, 'sourceCompletedOverride', completed_date_override,
           'monthBasis', 'recorded_completion_then_submission_europe_london',
           'sourceSpentTime', spent_time, 'sourceSpentTimeType', spent_time_type,
           'sourceHoursType', hours_type,
           'feedbacks', CASE WHEN jsonb_typeof(feedbacks) = 'array' THEN feedbacks ELSE '[]'::jsonb END,
           'documents', jsonb_build_array(jsonb_build_object('evidenceId', evidence_id, 'part', 'file', 'name', evidence_name))
             || CASE WHEN nullif(report_blob, '') IS NOT NULL
                     THEN jsonb_build_array(jsonb_build_object('evidenceId', evidence_id, 'part', 'report', 'name', 'Assessment report.pdf'))
                     ELSE '[]'::jsonb END
         )
       )
FROM source
WHERE NOT EXISTS (
  SELECT 1 FROM "Learner".learning_reflection_submissions existing
  WHERE existing.learner_kind = 'commercial' AND existing.learner_id = '125'
    AND existing.activity_type = 'assignment' AND existing.activity_id = source.activity_id
)
ON CONFLICT (id) DO NOTHING
RETURNING activity_id, activity_title, date_completed, status;
COMMIT;

-- Verify the result; should return 31 rows after the first successful import.
SELECT activity_id, activity_title, full_submission #>> '{monthlyAssignment,month}' AS month,
       status, submitted_at
FROM "Learner".learning_reflection_submissions
WHERE learner_kind = 'commercial' AND learner_id = '125'
  AND full_submission #>> '{legacyAssignment,importBatch}' = 'elmasry-92-v1'
ORDER BY month, activity_id;
