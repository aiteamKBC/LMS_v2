-- Catch the learner-plan id sequences up to the rows already in their tables.
--
-- Found 2026-11-14 on lms-ideal-architecture (br-raspy-sky-abvs8lq9):
--   "Learner".learner_training_plan_components  max(id) = 1663332, sequence last_value = 1663330
-- so the next inserts reuse existing ids and fail with
--   duplicate key value violates unique constraint "learner_training_plan_components_pkey".
-- Any write that adds a learner's plan components hits this, including module
-- assignment and the free-course adoption.
--
-- Safe to run more than once. It only ever moves a sequence forward and changes
-- no table rows. Run it on the intended database only.

SELECT current_setting('neon.branch_id', true) AS branch;  -- confirm the target first

SELECT setval('"Learner".learner_training_plan_modules_id_seq',
              greatest((SELECT coalesce(max(id), 1) FROM "Learner".learner_training_plan_modules),
                       (SELECT last_value FROM pg_sequences WHERE schemaname = 'Learner'
                          AND sequencename = 'learner_training_plan_modules_id_seq')));

SELECT setval('"Learner".learner_training_plan_weeks_id_seq',
              greatest((SELECT coalesce(max(id), 1) FROM "Learner".learner_training_plan_weeks),
                       (SELECT last_value FROM pg_sequences WHERE schemaname = 'Learner'
                          AND sequencename = 'learner_training_plan_weeks_id_seq')));

SELECT setval('"Learner".learner_training_plan_components_id_seq',
              greatest((SELECT coalesce(max(id), 1) FROM "Learner".learner_training_plan_components),
                       (SELECT last_value FROM pg_sequences WHERE schemaname = 'Learner'
                          AND sequencename = 'learner_training_plan_components_id_seq')));

-- Verify: every sequence is at or above its table's max(id).
SELECT 'components' AS tbl, (SELECT max(id) FROM "Learner".learner_training_plan_components) AS max_id,
       (SELECT last_value FROM pg_sequences WHERE schemaname = 'Learner'
          AND sequencename = 'learner_training_plan_components_id_seq') AS sequence_last;
