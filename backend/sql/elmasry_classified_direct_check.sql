WITH classified AS (
    SELECT DISTINCT ON (e.evidence_id)
      e.evidence_id, e.learner_id AS aptem_id, e.component_id,
      e.evidence_name, e.component_name, e.evidence_status,
      e.file_blob, e.report_blob, e.feedbacks, e.submission_date,
      coalesce((e.completed_date_override AT TIME ZONE 'Europe/London')::date,
               (e.completed_date AT TIME ZONE 'Europe/London')::date,
               v.completed_date,
               (e.submission_date AT TIME ZONE 'Europe/London')::date) AS activity_date,
      a."FullName" AS learner_name, a."Program Name" AS programme_name,
      run.id AS run_id
    FROM enrolment."Created_users" u
    JOIN "LMS"."Aptem_users" a ON a."ID"::text = btrim(u.aptem_id)
      AND nullif(lower(btrim(u."Email")), '') = lower(btrim(a."Email"))
    JOIN LATERAL (
      SELECT r.id FROM fetching_evidence.assignment_classification_runs r
      WHERE r.learner_id = a."ID" AND r.status = 'completed'
      ORDER BY (r.source_fingerprint IS NOT NULL) DESC,
               r.completed_at DESC NULLS LAST, r.id DESC LIMIT 1
    ) run ON true
    JOIN fetching_evidence.assignment_classification_evaluations v
      ON v.run_id = run.id AND v.learner_id = a."ID"
    JOIN fetching_evidence.evidence_items e
      ON e.learner_id = v.learner_id AND e.component_id = v.component_id
      AND (e.evidence_id = v.evidence_id OR v.source_evidence_ids @> to_jsonb(e.evidence_id))
    WHERE lower(btrim(u."Learner_type")) = 'commercial' AND u.id::text = '125'
      AND ('' = '' OR 'aptem:' || a."ID"::text || ':evidence:' || e.evidence_id::text = '')
    ORDER BY e.evidence_id, v.id
)
SELECT count(*) AS files, count(DISTINCT component_id) AS components,
 count(DISTINCT to_char(activity_date, 'YYYY-MM')) AS months,
 count(*) FILTER (WHERE file_blob IS NOT NULL) AS originals,
 count(*) FILTER (WHERE report_blob IS NOT NULL) AS reports
FROM classified;
