-- Read-only identity and source inventory. Run in Neon SQL Editor if needed.
SELECT a."ID" AS aptem_id, a."FullName" AS name,
       u.id AS enrolment_id, u."Learner_type" AS learner_type,
       l.id AS profile_id, l.learner_type AS profile_type,
       l.programme_id, l.cohort_id, l.group_id,
       lower(btrim(u."Email")) = lower(btrim(a."Email")) AS email_matches,
       lower(btrim(l.email)) = lower(btrim(a."Email")) AS profile_email_matches,
       r.id AS run_id, r.status AS run_status,
       r.assignments_found, r.unique_assignments_evaluated,
       (SELECT count(*) FROM fetching_evidence.assignment_classification_evaluations v
        WHERE v.run_id = r.id) AS evaluation_rows
FROM "LMS"."Aptem_users" a
LEFT JOIN enrolment."Created_users" u ON btrim(u.aptem_id) = a."ID"::text
LEFT JOIN "Learner".learners l ON l.enrolment_id = u.id
LEFT JOIN LATERAL (
  SELECT * FROM fetching_evidence.assignment_classification_runs r
  WHERE r.learner_id = a."ID" AND r.status = 'completed'
  ORDER BY (r.source_fingerprint IS NOT NULL) DESC,
           r.completed_at DESC NULLS LAST, r.id DESC LIMIT 1
) r ON true
WHERE a."FullName" ILIKE '%Elmasry%';
