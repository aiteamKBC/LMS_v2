-- Per-learner counts of what a coach has accepted and rejected.
--
-- Why the columns are needed
-- --------------------------
-- A learner's marking record -- how many assignments and reflections a coach
-- has accepted, and how many were sent back -- was only answerable by
-- aggregating "Learner".learning_reflection_submissions, which every screen
-- wanting the figure had to do for itself. These four hold the answer.
--
-- Assignment or reflection is decided by the component's authored type: an
-- assignment is assessed as a work product, everything else is evidenced
-- through the learner's reflection on the activity. The split is mirrored in
-- coach_api.views.ASSIGNMENT_ACTIVITY_TYPES and frontend/src/lib/markingKind.ts.
--
-- Recomputed, never incremented
-- -----------------------------
-- learner_api.marking_tally recomputes all four from the submissions after
-- every marking decision. A coach can change a decision and a learner can
-- resubmit; a counter nudged up on each decision would drift from the
-- submissions with nothing to show that it had. Recomputing is a handful of
-- rows per learner and always agrees with the source.
--
-- 'partial' counts as accepted (the learner was awarded something) and
-- 'referred' as rejected (it was sent back). 'submitted_for_tutor_review' and
-- 'escalated' count as neither: nobody has decided yet.
--
-- Backfill
-- --------
-- NOT NULL DEFAULT 0 starts every learner at zero, which is correct for a
-- counter with no history. The first marking decision after this ships
-- recomputes that learner's real totals from their existing submissions, so no
-- separate backfill is required -- though one can be forced for everybody with:
--
--   python manage.py shell -c "from learner_api.marking_tally import refresh_tally; \
--     from learner_api.models import LearnerProfile; \
--     [refresh_tally(p.id) for p in LearnerProfile.objects.all()]"
--
-- Safe to re-run. Additive only; no existing column, row or index is touched.

-- 1. Inspect first: do the columns exist, and how much marking history is there
--    to count once they do?
select (
         select count(*)
           from information_schema.columns
          where table_schema = 'Learner'
            and table_name   = 'learners'
            and column_name  = 'accepted_assignments'
       ) as columns_exist,
       count(*) filter (where status in ('accepted', 'partial'))  as accepted_submissions,
       count(*) filter (where status in ('rejected', 'referred')) as rejected_submissions,
       count(*) filter (where status not in ('accepted', 'partial', 'rejected', 'referred'))
         as still_awaiting_a_decision
  from "Learner"."learning_reflection_submissions";

-- 2. Apply.
alter table "Learner".learners
  add column if not exists accepted_assignments integer not null default 0;

alter table "Learner".learners
  add column if not exists rejected_assignments integer not null default 0;

alter table "Learner".learners
  add column if not exists accepted_reflections integer not null default 0;

alter table "Learner".learners
  add column if not exists rejected_reflections integer not null default 0;

-- 3. Verify.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'Learner'
   and table_name   = 'learners'
   and column_name in (
     'accepted_assignments', 'rejected_assignments',
     'accepted_reflections', 'rejected_reflections'
   )
 order by column_name;
