
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
SELECT evidence_id, component_id, evidence_name, activity_date, submission_date, activity_id FROM source ORDER BY activity_date, evidence_id;
