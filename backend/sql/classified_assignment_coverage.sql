-- Read-only coverage of the same identity and classification rules used by Assignments.
WITH coverage AS (
  SELECT u.id, lower(btrim(u."Learner_type")) AS learner_kind,
         a."ID" AS aptem_id, run.id AS run_id,
         count(DISTINCT e.evidence_id) AS assignments
  FROM enrolment."Created_users" u
  LEFT JOIN "LMS"."Aptem_users" a ON a."ID"::text = btrim(u.aptem_id)
    AND nullif(lower(btrim(u."Email")), '') = lower(btrim(a."Email"))
  LEFT JOIN LATERAL (
    SELECT r.id FROM fetching_evidence.assignment_classification_runs r
    WHERE r.learner_id = a."ID" AND r.status = 'completed'
    ORDER BY (r.source_fingerprint IS NOT NULL) DESC,
             r.completed_at DESC NULLS LAST, r.id DESC LIMIT 1
  ) run ON true
  LEFT JOIN fetching_evidence.assignment_classification_evaluations v
    ON v.run_id = run.id AND v.learner_id = a."ID"
  LEFT JOIN fetching_evidence.evidence_items e
    ON e.learner_id = v.learner_id AND e.component_id = v.component_id
    AND (e.evidence_id = v.evidence_id OR v.source_evidence_ids @> to_jsonb(e.evidence_id))
  WHERE lower(btrim(u."Learner_type")) IN ('commercial', 'apprenticeship')
  GROUP BY u.id, lower(btrim(u."Learner_type")), a."ID", run.id
)
SELECT learner_kind, count(*) AS learners,
       count(*) FILTER (WHERE aptem_id IS NULL) AS missing_verified_identity,
       count(*) FILTER (WHERE aptem_id IS NOT NULL AND run_id IS NULL) AS missing_completed_classification,
       count(*) FILTER (WHERE run_id IS NOT NULL AND assignments = 0) AS classified_without_evidence,
       count(*) FILTER (WHERE assignments > 0) AS learners_with_assignments,
       sum(assignments) AS assignments
FROM coverage GROUP BY learner_kind ORDER BY learner_kind;
