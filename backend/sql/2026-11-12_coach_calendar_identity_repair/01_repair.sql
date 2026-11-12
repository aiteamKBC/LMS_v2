-- Coach calendar identity repair. One transaction: all or nothing.
--
-- Re-files the coach calendar rows that carry enrolment."Created_users".id
-- under the learner's profile id, so the stored number names one learner.
-- Only learner_id changes. event_key, idempotency_key, Graph ids, meeting
-- links, attendance, review links and status are untouched, and no row is
-- deleted. Onboarding reviews are excluded: they stay under Created_users.id
-- by design (learner_api.calendar._record_owner_ids).
--
-- The previous value of every changed row is kept in
-- "Coach".coach_calendar_identity_repair_20261112 for audit and rollback,
-- because the link trigger rewrites raw_learner_id when learner_id changes.
-- None of these rows carries a verified_profile_id (00 checks this), so the
-- verification-reset trigger clears nothing.
--
-- Run 00 first. Deploy the LMS code fix and the Communication_Centre patch
-- before this, so no new Created_users-keyed rows appear afterwards.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "Coach".coach_calendar_identity_repair_20261112 (
    calendar_event_id      bigint PRIMARY KEY,
    event_key              text NOT NULL,
    event_type             text NOT NULL,
    previous_learner_id    integer NOT NULL,
    previous_identity_kind text NOT NULL,
    repaired_learner_id    integer NOT NULL,
    repaired_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "Coach".coach_calendar_identity_repair_20261112 (
    calendar_event_id, event_key, event_type, previous_learner_id, previous_identity_kind, repaired_learner_id
)
SELECT e.id, e.event_key, e.event_type, e.learner_id, k.identity_kind, p.id
FROM "Learner".coach_calendar_event e
JOIN "Coach".coach_calendar_event_learner_link k
  ON k.calendar_event_id = e.id
 AND k.identity_kind = 'enrolment'
 AND k.enrolment_id = e.learner_id
 AND k.verified_profile_id IS NULL
JOIN "Learner".learners p ON p.enrolment_id = e.learner_id
WHERE e.event_type NOT IN ('eligibility-review', 'workspace', 'training-plan', 'uln-privacy')
ON CONFLICT (calendar_event_id) DO NOTHING;

-- Guarded by the previous value, so a re-run or a row changed since is a no-op.
UPDATE "Learner".coach_calendar_event e
   SET learner_id = r.repaired_learner_id
  FROM "Coach".coach_calendar_identity_repair_20261112 r
 WHERE r.calendar_event_id = e.id
   AND e.learner_id = r.previous_learner_id;

-- Every repaired row must now resolve as a profile in the link table.
DO $$
DECLARE
    expected integer;
    resolved integer;
BEGIN
    SELECT count(*) INTO expected FROM "Coach".coach_calendar_identity_repair_20261112;
    SELECT count(*) INTO resolved
      FROM "Coach".coach_calendar_identity_repair_20261112 r
      JOIN "Coach".coach_calendar_event_learner_link k ON k.calendar_event_id = r.calendar_event_id
     WHERE k.identity_kind = 'profile' AND k.learner_profile_id = r.repaired_learner_id;
    IF resolved <> expected THEN
        RAISE EXCEPTION 'identity repair: % of % rows resolve as profile; rolling back', resolved, expected;
    END IF;
END
$$;

COMMIT;

-- Verify (read-only). Expect: enrolment 0 for non-onboarding rows; profile 231.
SELECT k.identity_kind, count(*)
FROM "Coach".coach_calendar_event_learner_link k
JOIN "Learner".coach_calendar_event e ON e.id = k.calendar_event_id
WHERE e.event_type NOT IN ('eligibility-review', 'workspace', 'training-plan', 'uln-privacy')
GROUP BY 1
ORDER BY 1;
