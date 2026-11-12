-- Evidence identity: read-only proof of what evidence_items.learner_record_id is.
-- Expected on the 2026-11-12 Development snapshot, for fetching_evidence.evidence_items:
--   aptem_learners 630, one_record_id_each 630, shared_record_ids 0,
--   record_id_is_learner_evidence_row 630, same_aptem_id 630.
BEGIN READ ONLY;

-- 1. learner_record_id is a stable per-learner key: one value per Aptem learner, never shared.
SELECT count(*) AS aptem_learners,
       count(*) FILTER (WHERE n = 1) AS one_record_id_each,
       (SELECT count(*) FROM (SELECT learner_record_id FROM fetching_evidence.evidence_items
                               GROUP BY 1 HAVING count(DISTINCT learner_id) > 1) s) AS shared_record_ids
FROM (SELECT learner_id, count(DISTINCT learner_record_id) AS n
      FROM fetching_evidence.evidence_items GROUP BY 1) x;

-- 2. It is the fetcher's own row id in fetching_evidence.learner_evidence, for the same Aptem learner.
SELECT count(DISTINCT e.learner_record_id) AS record_id_is_learner_evidence_row,
       count(DISTINCT e.learner_record_id) FILTER (WHERE le.learner_id::text = e.learner_id::text) AS same_aptem_id
FROM fetching_evidence.evidence_items e
JOIN fetching_evidence.learner_evidence le ON le.id = e.learner_record_id;

-- 3. It is NOT the learner profile id: compare with the profile reached through
--    Created_users.aptem_id and the unique learners.enrolment_id.
WITH m AS (
    SELECT btrim(u.aptem_id) AS aptem, min(p.id) AS profile_id, count(DISTINCT p.id) AS n
    FROM enrolment."Created_users" u
    JOIN "Learner".learners p ON p.enrolment_id = u.id
    WHERE coalesce(btrim(u.aptem_id), '') <> ''
    GROUP BY 1
)
SELECT count(*) AS evidence_rows,
       count(*) FILTER (WHERE m.n = 1 AND e.learner_record_id = m.profile_id) AS equals_profile_id_by_coincidence,
       count(*) FILTER (WHERE m.n = 1 AND e.learner_record_id <> m.profile_id) AS differs_from_profile_id,
       count(*) FILTER (WHERE m.aptem IS NULL) AS aptem_learner_not_in_lms
FROM fetching_evidence.evidence_items e
LEFT JOIN m ON m.aptem = e.learner_id::text;

-- 4. Learner.evidence_items is an older copy of fetching_evidence.evidence_items.
SELECT count(*) FILTER (WHERE a.evidence_id IS NOT NULL AND b.evidence_id IS NOT NULL) AS in_both,
       count(*) FILTER (WHERE b.evidence_id IS NULL) AS only_in_learner_copy,
       count(*) FILTER (WHERE a.evidence_id IS NULL) AS only_in_fetching_evidence,
       count(*) FILTER (WHERE a.evidence_id IS NOT NULL AND b.evidence_id IS NOT NULL
                          AND (a.learner_id IS DISTINCT FROM b.learner_id
                               OR a.learner_record_id IS DISTINCT FROM b.learner_record_id)) AS identity_differs,
       count(*) FILTER (WHERE a.evidence_id IS NOT NULL AND b.evidence_id IS NOT NULL
                          AND a.source_hash IS DISTINCT FROM b.source_hash) AS content_differs,
       (SELECT max(updated_at)::date FROM "Learner".evidence_items) AS learner_copy_last_update,
       (SELECT max(updated_at)::date FROM fetching_evidence.evidence_items) AS fetching_last_update
FROM "Learner".evidence_items a
FULL JOIN fetching_evidence.evidence_items b ON a.evidence_id = b.evidence_id;

ROLLBACK;
