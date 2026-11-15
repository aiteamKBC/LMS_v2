-- DBA REVIEW ONLY: catch the learner-plan id sequences up to existing rows.
--
-- Read-only Development evidence captured 2026-11-15 on
-- lms-ideal-architecture (br-raspy-sky-abvs8lq9):
--
--   table                                      max(id)  last_value  next value
--   learner_training_plan_modules                11668       11668       11669
--   learner_training_plan_weeks                 195651      195641      195642
--   learner_training_plan_components           1696387     1695574     1695575
--
-- The weeks/components sequences can therefore generate an existing primary
-- key. This script is idempotent and forward-only: it never lowers a sequence
-- and it does not change learner-plan rows. The locks close the race between
-- reading max(id) and setting each sequence. Confirm the branch printed below
-- before execution. Do not run this file on shared Development or Production
-- without the normal DBA/change-review approval.

BEGIN;

SELECT current_setting('neon.branch_id', true) AS branch_to_confirm;

LOCK TABLE
    "Learner".learner_training_plan_modules,
    "Learner".learner_training_plan_weeks,
    "Learner".learner_training_plan_components
IN SHARE ROW EXCLUSIVE MODE;

SELECT setval(
    '"Learner".learner_training_plan_modules_id_seq'::regclass,
    GREATEST(
        COALESCE((SELECT max(id) FROM "Learner".learner_training_plan_modules), 1),
        COALESCE((SELECT last_value FROM pg_sequences
                  WHERE schemaname = 'Learner'
                    AND sequencename = 'learner_training_plan_modules_id_seq'), 1)
    ),
    true
);

SELECT setval(
    '"Learner".learner_training_plan_weeks_id_seq'::regclass,
    GREATEST(
        COALESCE((SELECT max(id) FROM "Learner".learner_training_plan_weeks), 1),
        COALESCE((SELECT last_value FROM pg_sequences
                  WHERE schemaname = 'Learner'
                    AND sequencename = 'learner_training_plan_weeks_id_seq'), 1)
    ),
    true
);

SELECT setval(
    '"Learner".learner_training_plan_components_id_seq'::regclass,
    GREATEST(
        COALESCE((SELECT max(id) FROM "Learner".learner_training_plan_components), 1),
        COALESCE((SELECT last_value FROM pg_sequences
                  WHERE schemaname = 'Learner'
                    AND sequencename = 'learner_training_plan_components_id_seq'), 1)
    ),
    true
);

-- Every sequence must be at or above max(id) before COMMIT.
WITH state(table_name, max_id, sequence_last) AS (
    VALUES
        (
            'learner_training_plan_modules',
            (SELECT max(id) FROM "Learner".learner_training_plan_modules),
            (SELECT last_value FROM pg_sequences
             WHERE schemaname = 'Learner'
               AND sequencename = 'learner_training_plan_modules_id_seq')
        ),
        (
            'learner_training_plan_weeks',
            (SELECT max(id) FROM "Learner".learner_training_plan_weeks),
            (SELECT last_value FROM pg_sequences
             WHERE schemaname = 'Learner'
               AND sequencename = 'learner_training_plan_weeks_id_seq')
        ),
        (
            'learner_training_plan_components',
            (SELECT max(id) FROM "Learner".learner_training_plan_components),
            (SELECT last_value FROM pg_sequences
             WHERE schemaname = 'Learner'
               AND sequencename = 'learner_training_plan_components_id_seq')
        )
)
SELECT table_name,
       max_id,
       sequence_last,
       sequence_last >= COALESCE(max_id, 0) AS aligned
FROM state
ORDER BY table_name;

COMMIT;
