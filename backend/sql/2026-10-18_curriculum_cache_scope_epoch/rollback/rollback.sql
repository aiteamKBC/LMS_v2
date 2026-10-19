-- Curriculum cache scope epochs -- ROLLBACK. Not part of the apply sequence.
--
-- Removes the table 02_apply.sql created. The backend notices within a minute
-- and returns to global invalidation for every page; no data is lost (the rows
-- are cache counters only). Restarting the backend services makes it immediate.

begin;
drop table if exists curriculum.cache_scope_epoch;
commit;

-- Expect: null.
select to_regclass('curriculum.cache_scope_epoch') as still_present;
