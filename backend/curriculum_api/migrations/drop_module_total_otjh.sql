-- Migration: Remove stored curriculum.modules.total_otjh column
--
-- Expected OTJH is now calculated dynamically by summing expected_otjh
-- from active Curriculum Components (via curriculum.weeks and curriculum.components).
--
-- Prerequisites before running:
--   1. Deploy the application code change that removes all reads/writes of this column.
--   2. Verify the new module_expected_otjh_sql() subquery returns correct values.
--   3. Take a database backup / snapshot.
--   4. Run with RESTRICT to confirm no other objects depend on the column.
--
-- NOT EXECUTED AUTOMATICALLY.  Apply manually after the above prerequisites are met.

ALTER TABLE curriculum.modules
    DROP COLUMN total_otjh RESTRICT;
