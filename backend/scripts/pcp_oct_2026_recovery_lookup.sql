-- ============================================================================
-- READ-ONLY recovery lookup for "PCP Oct 2026"  (PROG-20260719080415142493)
-- ============================================================================
-- Run this against a Neon PITR branch / restore copy — NOT against production.
-- It contains SELECT statements only. Nothing here writes, deletes or restores.
--
-- Suggested restore point: on or before 2026-07-22 12:57:32 UTC, the last
-- updated_at on the surviving child rows. The programme row was deleted some
-- time after that, so a branch taken at/just before that moment should still
-- contain it.
--
-- HOW TO USE
--   1. Neon console -> Branches -> create a branch from `production`
--      restored to 2026-07-22 13:00:00 UTC.
--   2. Connect to THAT branch and run this file.
--   3. Compare the output with the surviving rows in production before
--      deciding what (if anything) to reinstate.
-- ============================================================================

-- Guard: make the whole session incapable of writing.
SET default_transaction_read_only = ON;

\echo '--- 1. the deleted programme row ---'
SELECT *
FROM curriculum.programmes
WHERE programme_id = 'PROG-20260719080415142493'
   OR name ILIKE '%PCP%Oct%2026%';

\echo '--- 2. its cohorts ---'
SELECT *
FROM curriculum.cohorts
WHERE programme_id = 'PROG-20260719080415142493';

\echo '--- 3. its groups ---'
SELECT *
FROM curriculum.groups
WHERE programme_id = 'PROG-20260719080415142493';

\echo '--- 4. the three referenced modules (MISSING in production) ---'
SELECT *
FROM curriculum.modules
WHERE module_catalogue_id IN (
    'MOD-20260719080421438402',   -- PMP 28s
    'MOD-20260719080426707816',   -- EVM
    'MOD-20260719080648518324'    -- Chartered Credit
)
   OR programme_id = 'PROG-20260719080415142493';

\echo '--- 5. weeks belonging to those modules ---'
SELECT *
FROM curriculum.weeks
WHERE module_catalogue_id IN (
    'MOD-20260719080421438402',
    'MOD-20260719080426707816',
    'MOD-20260719080648518324'
)
ORDER BY module_catalogue_id, week_number, display_order;

\echo '--- 6. components belonging to those modules ---'
SELECT *
FROM curriculum.components
WHERE module_catalogue_id IN (
    'MOD-20260719080421438402',
    'MOD-20260719080426707816',
    'MOD-20260719080648518324'
)
ORDER BY module_catalogue_id, display_order;

\echo '--- 7. KSB mappings for those modules ---'
SELECT *
FROM curriculum.ksb_mappings
WHERE module_catalogue_id IN (
    'MOD-20260719080421438402',
    'MOD-20260719080426707816',
    'MOD-20260719080648518324'
);

\echo '--- 8. anything else still pointing at the programme ---'
SELECT 'week_templates' AS source, COUNT(*) FROM curriculum.week_templates WHERE programme_id = 'PROG-20260719080415142493'
UNION ALL SELECT 'quizzes',        COUNT(*) FROM curriculum.quizzes        WHERE programme_id = 'PROG-20260719080415142493'
UNION ALL SELECT 'module_details', COUNT(*) FROM curriculum.module_details WHERE module_catalogue_id IN (
    'MOD-20260719080421438402','MOD-20260719080426707816','MOD-20260719080648518324');

\echo '--- 9. learner impact: did anyone consume those modules? ---'
SELECT 'training_plan_modules' AS source, COUNT(*)
FROM "Learner".learner_training_plan_modules
WHERE curriculum_module_id IN (
    'MOD-20260719080421438402','MOD-20260719080426707816','MOD-20260719080648518324');
