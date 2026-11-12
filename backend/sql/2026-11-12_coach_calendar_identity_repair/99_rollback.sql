-- ROLLBACK ONLY. Not an apply step. Restores the Created_users.id each row had
-- before 01, from the audit table 01 wrote. The link trigger then re-derives
-- identity_kind = 'enrolment' for those rows. The audit table is kept.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "Learner".coach_calendar_event e
   SET learner_id = r.previous_learner_id
  FROM "Coach".coach_calendar_identity_repair_20261112 r
 WHERE r.calendar_event_id = e.id
   AND e.learner_id = r.repaired_learner_id;

COMMIT;
