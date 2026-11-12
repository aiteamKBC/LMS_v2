-- Coach calendar identity repair: read-only preflight. Run on the exact target first.
-- Expected on the 2026-11-12 Development snapshot:
--   candidates 52, distinct_events 52, ambiguous_profiles 0, sequence_collisions 0.
-- Any other value: stop and re-investigate before running 01.
BEGIN READ ONLY;

WITH candidates AS (
    SELECT e.id, e.event_type, e.sequence, e.learner_id AS enrolment_id, p.id AS profile_id
    FROM "Learner".coach_calendar_event e
    JOIN "Coach".coach_calendar_event_learner_link k
      ON k.calendar_event_id = e.id
     AND k.identity_kind = 'enrolment'        -- the trigger matched Created_users by id AND email
     AND k.enrolment_id = e.learner_id
    JOIN "Learner".learners p ON p.enrolment_id = e.learner_id
    WHERE e.event_type NOT IN ('eligibility-review', 'workspace', 'training-plan', 'uln-privacy')
)
SELECT
    (SELECT count(*) FROM candidates) AS candidates,
    (SELECT count(DISTINCT id) FROM candidates) AS distinct_events,
    (SELECT count(*) FROM (SELECT id FROM candidates GROUP BY id HAVING count(DISTINCT profile_id) > 1) x)
        AS ambiguous_profiles,
    (SELECT count(*) FROM candidates c
       JOIN "Learner".coach_calendar_event other
         ON other.learner_id = c.profile_id AND other.event_type = c.event_type
        AND other.sequence = c.sequence AND other.id <> c.id
      WHERE c.event_type IN ('catch-up', 'student-support')) AS sequence_collisions,
    (SELECT count(*) FROM candidates c
       JOIN "Coach".coach_calendar_event_learner_link k ON k.calendar_event_id = c.id
      WHERE k.verified_profile_id IS NOT NULL) AS verified_rows_affected;   -- expected 0

-- The rows, by event type and writer (no personal data).
SELECT e.event_type,
       split_part(coalesce(e.idempotency_key, ''), ':', 1) AS writer_key,
       count(*)
FROM "Learner".coach_calendar_event e
JOIN "Coach".coach_calendar_event_learner_link k
  ON k.calendar_event_id = e.id AND k.identity_kind = 'enrolment'
GROUP BY 1, 2
ORDER BY 1, 2;

-- Not repaired by 01 (reported for manual review): unlinked or unresolved events.
SELECT e.id, e.event_type, e.status, coalesce(k.identity_kind, 'no link row') AS identity_kind,
       k.verification_basis
FROM "Learner".coach_calendar_event e
LEFT JOIN "Coach".coach_calendar_event_learner_link k ON k.calendar_event_id = e.id
WHERE k.calendar_event_id IS NULL OR k.identity_kind = 'unresolved'
ORDER BY e.id;

ROLLBACK;
