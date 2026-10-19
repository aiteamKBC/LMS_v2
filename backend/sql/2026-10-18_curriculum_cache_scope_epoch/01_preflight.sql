-- Curriculum cache scope epochs -- step 1: preflight. READ ONLY.
--
-- Run against the database the backend's Database_url points at. Every row
-- below should read as noted before you run 02_apply.sql.

-- The schema exists and the app already owns its global counter (expect 1 row).
select schemaname, tablename, tableowner
from pg_tables
where schemaname = 'curriculum' and tablename = 'cache_epoch';

-- The new table is not there yet (expect: null). If it is, stop: compare its
-- columns with 02_apply.sql rather than re-creating it.
select to_regclass('curriculum.cache_scope_epoch') as already_present;

-- The role you are connected as (expect the same owner as cache_epoch above,
-- so the backend can read and update the new table).
select current_user;

-- Columns the backend's dependency lookup reads (expect 3 rows on modules,
-- and programme_id on groups, cohorts and programmes).
select table_name, column_name
from information_schema.columns
where table_schema = 'curriculum'
  and (
    (table_name = 'modules' and column_name in ('module_catalogue_id', 'source_id', 'teams_shared_source_module_id'))
    or (table_name in ('groups', 'cohorts', 'programmes') and column_name = 'programme_id')
  )
order by table_name, column_name;
