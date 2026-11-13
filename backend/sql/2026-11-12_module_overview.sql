-- Learner Module Overview: authored descriptive metadata for one module.
--
-- NOT RUN AUTOMATICALLY. Equivalent to curriculum_api migration 0086
-- (curriculum_api/module_overview_schema.py). Apply only after verifying the
-- target database and taking a backup/restore point.
--
-- Additive and backward compatible: a nullable column, NULL on every existing
-- row, no backfill. NULL means "no overview authored"; the Module Builder then
-- shows "Add Module Details" and learners see only the existing module facts.
-- Until this runs, the overview endpoints answer 503 and the learner read
-- returns no authored overview -- nothing else changes.

alter table curriculum.modules
    add column if not exists module_overview jsonb null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'modules_module_overview_is_object'
          and conrelid = 'curriculum.modules'::regclass
    ) then
        alter table curriculum.modules
            add constraint modules_module_overview_is_object
            check (module_overview is null or jsonb_typeof(module_overview) = 'object');
    end if;
end
$$;

-- Verification (read-only):
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'curriculum' and table_name = 'modules'
--   and column_name = 'module_overview';
--
-- select count(*) filter (where module_overview is not null) as with_overview,
--        count(*) as total
-- from curriculum.modules;
--
-- Rollback (destroys authored overviews):
--
-- alter table curriculum.modules drop constraint if exists modules_module_overview_is_object;
-- alter table curriculum.modules drop column if exists module_overview;
