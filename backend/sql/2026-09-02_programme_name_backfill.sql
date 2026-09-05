-- Refresh the denormalized programme_name carried on curriculum children.
-- Written 2026-09-02. NOT YET RUN anywhere.
--
-- WHY
--   curriculum.cohorts, curriculum.groups and curriculum.modules each store a
--   copy of their programme's name beside the canonical programme_id. A rename
--   is supposed to push the new name down (propagate_programme_name), but rows
--   written before that existed still hold the old one. Observed on
--   PROG-20260824104138483006: the programme is named "MM" and all 64 of its
--   modules, its cohort and its group still say "MBA" -- which is also the name
--   of a different live programme, PROG-20260824094628753289.
--
--   That copy is read as an identity wherever a row carries no programme_id, so
--   the drift did real damage: MM's programme card counted 0 modules, 0 groups
--   and 0 weeks while its own page listed 64 modules, 1 group and 641 weeks, and
--   MBA's page listed MM's 64 modules as its own.
--
--   The application code no longer trusts the name over the id (an explicit
--   programme_id now wins outright), and repair_curriculum_parent_links pushes
--   the programme's current name down on every save of that programme. This
--   script is the one-off catch-up for rows that will not be saved again.
--
-- WHAT IT TOUCHES
--   Only programme_name, and only on rows whose programme_id resolves to a
--   programme whose name differs. programme_id -- the real relationship -- is
--   never written. Soft-deleted and archived rows are included on purpose: they
--   belong to the same programme and the archive views read the same column.
--
-- HOW TO RUN
--   1. Run on a Neon branch first, not production.
--   2. Run the SELECT at the top to see what will change, and the one at the
--      bottom to confirm nothing is left.
--   3. The three UPDATEs are idempotent -- re-running changes nothing.
--
-- Rollback: none needed (the old values are stale copies of a name the
-- programmes table still holds), but capture the preview SELECT first if you
-- want a record of what they were.

-- Preview: every child row whose stored name disagrees with its programme.
select 'cohorts' as table_name, c.cohort_id as row_id, c.programme_id,
       c.programme_name as stored_name, p.name as programme_name
  from "curriculum"."cohorts" c
  join "curriculum"."programmes" p on p.programme_id = c.programme_id
 where coalesce(c.programme_name, '') <> coalesce(p.name, '')
union all
select 'groups', g.group_id, g.programme_id, g.programme_name, p.name
  from "curriculum"."groups" g
  join "curriculum"."programmes" p on p.programme_id = g.programme_id
 where coalesce(g.programme_name, '') <> coalesce(p.name, '')
union all
select 'modules', m.module_catalogue_id, m.programme_id, m.programme_name, p.name
  from "curriculum"."modules" m
  join "curriculum"."programmes" p on p.programme_id = m.programme_id
 where coalesce(m.programme_name, '') <> coalesce(p.name, '')
 order by table_name, row_id;

-- 1. Cohorts.
update "curriculum"."cohorts" c
   set programme_name = p.name,
       updated_at = now()
  from "curriculum"."programmes" p
 where p.programme_id = c.programme_id
   and coalesce(c.programme_name, '') <> coalesce(p.name, '');

-- 2. Groups.
update "curriculum"."groups" g
   set programme_name = p.name,
       updated_at = now()
  from "curriculum"."programmes" p
 where p.programme_id = g.programme_id
   and coalesce(g.programme_name, '') <> coalesce(p.name, '');

-- 3. Modules.
update "curriculum"."modules" m
   set programme_name = p.name,
       updated_at = now()
  from "curriculum"."programmes" p
 where p.programme_id = m.programme_id
   and coalesce(m.programme_name, '') <> coalesce(p.name, '');

-- Confirm: expect zero rows.
select 'cohorts' as table_name, count(*) as still_stale
  from "curriculum"."cohorts" c
  join "curriculum"."programmes" p on p.programme_id = c.programme_id
 where coalesce(c.programme_name, '') <> coalesce(p.name, '')
union all
select 'groups', count(*)
  from "curriculum"."groups" g
  join "curriculum"."programmes" p on p.programme_id = g.programme_id
 where coalesce(g.programme_name, '') <> coalesce(p.name, '')
union all
select 'modules', count(*)
  from "curriculum"."modules" m
  join "curriculum"."programmes" p on p.programme_id = m.programme_id
 where coalesce(m.programme_name, '') <> coalesce(p.name, '');
