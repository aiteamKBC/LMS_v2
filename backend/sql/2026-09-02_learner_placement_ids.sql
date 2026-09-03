-- Add and backfill "Learner".learners.cohort_id / group_id.
-- Written 2026-09-02. NOT YET RUN anywhere.
--
-- WHY
--   "Learner"."learners" records a learner's placement as three pieces of free
--   text -- programme, cohort, group_name -- and curriculum owns the records
--   those names refer to. programme already has its stable key beside it
--   (programme_id, added by apply_learner_enrolment_id); cohort and group do
--   not, so every curriculum read that asks "who is in this group" has to
--   compare names:
--
--     curriculum_api/views.py:assigned_learners_for_scope
--       normalise(row['cohort']) == normalise(lineage['cohortName'])
--       normalise(row['group'])  == normalise(lineage['groupName'])
--
--   That comparison is case- and punctuation-insensitive, which hides the
--   ordinary drift but not the real kind. Rename a cohort and every learner in
--   it silently leaves the group's roster: the group record still says
--   "Autumn 2025", the learner row still says "Autumn 25", and the Groups tab
--   reports a group with two learners in it as empty. Nothing errors, so the
--   only symptom is a missing person.
--
--   Group names make it worse: they are only unique WITHIN a cohort (see
--   resolve_group_row, which refuses a bare-name lookup for exactly this
--   reason). Two cohorts each running a "Group A" are told apart only by the
--   cohort name matching as well, so one renamed cohort can move learners onto
--   the wrong group's roster rather than off it.
--
--   These two columns are the fix. After this, a placement is a reference to a
--   record, and a rename is just a rename.
--
-- WHAT IT TOUCHES
--   Adds two nullable columns and two indexes, then writes ONLY those columns.
--   No existing column is read for anything but matching, and none is written:
--   programme, cohort and group_name keep the text enrolment captured, because
--   they are what the enrolment screens edit and what every other consumer
--   still reads. The ids sit beside them.
--
--   A row is linked only when the name resolves to EXACTLY ONE live curriculum
--   record. Ambiguous and unmatched rows are left NULL on purpose -- the
--   application keeps matching those by name, so a partial backfill is a
--   partial improvement and never a regression. This is the same rule
--   _resolve_linkable_programme_id already applies to programme_id.
--
--   Soft-deleted, programme-deleted and archived curriculum rows are excluded
--   from matching. The flag columns differ between environments (the code tests
--   each with has_column), so each is read through to_jsonb -- a column that is
--   not there reads as NULL and the row is treated as live.
--
-- HOW TO RUN
--   1. Run on a Neon branch first, not production.
--   2. Run step 0 (the two ALTERs and two indexes), then the PREVIEW select to
--      see what would be linked and what stays ambiguous.
--   3. Run steps 1 and 2 IN ORDER -- step 2 scopes each group by the cohort_id
--      step 1 just wrote, which is what makes a non-unique group name resolve.
--   4. Run the CONFIRM selects at the bottom.
--   5. All statements are idempotent: re-running changes nothing.
--
-- Rollback:
--   update "Learner"."learners" set cohort_id = null, group_id = null;
--   -- or, to remove them entirely:
--   -- drop index if exists "Learner".learners_cohort_id_idx;
--   -- drop index if exists "Learner".learners_group_id_idx;
--   -- alter table "Learner"."learners" drop column if exists cohort_id;
--   -- alter table "Learner"."learners" drop column if exists group_id;


-- ---------------------------------------------------------------------------
-- 0. The columns.
--
-- varchar(64) to match programme_id and the curriculum key columns they point
-- at; these ids are strings ('COHORT-20260824...'), not numbers. Nullable with
-- no default: NULL means "not resolved", which the application reads as
-- "fall back to the name".
-- ---------------------------------------------------------------------------
alter table "Learner"."learners" add column if not exists "cohort_id" varchar(64);
alter table "Learner"."learners" add column if not exists "group_id"  varchar(64);

create index if not exists "learners_cohort_id_idx" on "Learner"."learners" ("cohort_id");
create index if not exists "learners_group_id_idx"  on "Learner"."learners" ("group_id");


-- ---------------------------------------------------------------------------
-- PREVIEW. What step 1 and step 2 would resolve, and what they would not.
--
-- Read the `matches` column: 1 is linked, 0 is a name no live record carries,
-- and >1 is a name that identifies more than one record. The last two stay
-- NULL and keep matching by name -- they are the rows worth looking at by hand.
-- ---------------------------------------------------------------------------
with live_cohorts as (
  select c.cohort_id, c.cohort_name, c.programme_id, c.programme_name
    from "curriculum"."cohorts" c
   where coalesce(to_jsonb(c) ->> 'deleted_at', '') = ''
     and coalesce(to_jsonb(c) ->> 'is_programme_deleted', 'false') not in ('true', 't')
     and coalesce(to_jsonb(c) ->> 'is_archived', 'false') not in ('true', 't')
)
select l.id                                    as learner_id,
       l.full_name,
       l.programme,
       l.cohort                                as stored_cohort_name,
       count(c.cohort_id)                      as matches,
       case when count(c.cohort_id) = 1
            then min(c.cohort_id) end          as would_link_cohort_id
  from "Learner"."learners" l
  left join live_cohorts c
    on regexp_replace(lower(coalesce(c.cohort_name, '')), '[^a-z0-9]+', '', 'g')
     = regexp_replace(lower(coalesce(l.cohort, '')),      '[^a-z0-9]+', '', 'g')
   and (
         (coalesce(btrim(l.programme_id), '') <> '' and c.programme_id = btrim(l.programme_id))
      or (coalesce(btrim(l.programme_id), '') =  ''
          and regexp_replace(lower(coalesce(c.programme_name, '')), '[^a-z0-9]+', '', 'g')
            = regexp_replace(lower(coalesce(l.programme, '')),      '[^a-z0-9]+', '', 'g'))
       )
 where regexp_replace(lower(coalesce(l.cohort, '')), '[^a-z0-9]+', '', 'g') <> ''
 group by l.id, l.full_name, l.programme, l.cohort
 order by matches, lower(l.full_name), l.id;


-- ---------------------------------------------------------------------------
-- 1. cohort_id, from the cohort name within the learner's programme.
--
-- The programme is matched by id where the learner carries one and by
-- normalised name only where they do not -- the same precedence the read path
-- uses, and the reason a renamed programme does not scatter its cohorts.
-- ---------------------------------------------------------------------------
with live_cohorts as (
  select c.cohort_id, c.cohort_name, c.programme_id, c.programme_name
    from "curriculum"."cohorts" c
   where coalesce(to_jsonb(c) ->> 'deleted_at', '') = ''
     and coalesce(to_jsonb(c) ->> 'is_programme_deleted', 'false') not in ('true', 't')
     and coalesce(to_jsonb(c) ->> 'is_archived', 'false') not in ('true', 't')
),
matched as (
  select l.id                as learner_id,
         min(c.cohort_id)    as cohort_id,
         count(*)            as matches
    from "Learner"."learners" l
    join live_cohorts c
      on regexp_replace(lower(coalesce(c.cohort_name, '')), '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(coalesce(l.cohort, '')),      '[^a-z0-9]+', '', 'g')
     and (
           (coalesce(btrim(l.programme_id), '') <> '' and c.programme_id = btrim(l.programme_id))
        or (coalesce(btrim(l.programme_id), '') =  ''
            and regexp_replace(lower(coalesce(c.programme_name, '')), '[^a-z0-9]+', '', 'g')
              = regexp_replace(lower(coalesce(l.programme, '')),      '[^a-z0-9]+', '', 'g'))
         )
   where regexp_replace(lower(coalesce(l.cohort, '')), '[^a-z0-9]+', '', 'g') <> ''
   group by l.id
)
update "Learner"."learners" l
   set cohort_id = m.cohort_id,
       updated_at = now()
  from matched m
 where m.learner_id = l.id
   and m.matches = 1
   and l.cohort_id is distinct from m.cohort_id;


-- ---------------------------------------------------------------------------
-- 2. group_id, from the group name within the cohort step 1 resolved.
--
-- MUST run after step 1. A group name is only unique inside its cohort, so
-- scoping by the resolved cohort_id is what turns "Group A" from ambiguous
-- into a single row. Where the cohort did not resolve this falls back to the
-- programme, which is wider and will more often come back ambiguous -- and an
-- ambiguous name is deliberately left unlinked rather than guessed at.
-- ---------------------------------------------------------------------------
with live_groups as (
  select g.group_id, g.group_name, g.cohort_id, g.programme_id, g.programme_name
    from "curriculum"."groups" g
   where coalesce(to_jsonb(g) ->> 'deleted_at', '') = ''
     and coalesce(to_jsonb(g) ->> 'is_programme_deleted', 'false') not in ('true', 't')
     and coalesce(to_jsonb(g) ->> 'is_archived', 'false') not in ('true', 't')
),
matched as (
  select l.id              as learner_id,
         min(g.group_id)   as group_id,
         count(*)          as matches
    from "Learner"."learners" l
    join live_groups g
      on regexp_replace(lower(coalesce(g.group_name, '')),  '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(coalesce(l.group_name, '')),  '[^a-z0-9]+', '', 'g')
     and (
           (coalesce(btrim(l.cohort_id), '') <> '' and g.cohort_id = btrim(l.cohort_id))
        or (coalesce(btrim(l.cohort_id), '') =  '' and (
                 (coalesce(btrim(l.programme_id), '') <> '' and g.programme_id = btrim(l.programme_id))
              or (coalesce(btrim(l.programme_id), '') =  ''
                  and regexp_replace(lower(coalesce(g.programme_name, '')), '[^a-z0-9]+', '', 'g')
                    = regexp_replace(lower(coalesce(l.programme, '')),      '[^a-z0-9]+', '', 'g'))
           ))
         )
   where regexp_replace(lower(coalesce(l.group_name, '')), '[^a-z0-9]+', '', 'g') <> ''
   group by l.id
)
update "Learner"."learners" l
   set group_id = m.group_id,
       updated_at = now()
  from matched m
 where m.learner_id = l.id
   and m.matches = 1
   and l.group_id is distinct from m.group_id;


-- ---------------------------------------------------------------------------
-- CONFIRM 1. How far the backfill got. `unresolved_*` rows are not a failure:
-- they keep matching by name, exactly as they did before this script.
-- ---------------------------------------------------------------------------
select count(*)                                                          as learners,
       count(*) filter (where coalesce(btrim(cohort), '') <> '')          as with_cohort_name,
       count(*) filter (where coalesce(btrim(cohort_id), '') <> '')       as with_cohort_id,
       count(*) filter (where coalesce(btrim(cohort), '') <> ''
                          and coalesce(btrim(cohort_id), '') = '')        as unresolved_cohort,
       count(*) filter (where coalesce(btrim(group_name), '') <> '')      as with_group_name,
       count(*) filter (where coalesce(btrim(group_id), '') <> '')        as with_group_id,
       count(*) filter (where coalesce(btrim(group_name), '') <> ''
                          and coalesce(btrim(group_id), '') = '')         as unresolved_group
  from "Learner"."learners";


-- ---------------------------------------------------------------------------
-- CONFIRM 2. Every id written points at a live record, and a linked group
-- agrees with the linked cohort. Expect zero rows.
-- ---------------------------------------------------------------------------
select 'cohort_id points at no cohort' as problem, l.id as learner_id,
       l.cohort_id as bad_value, l.group_id
  from "Learner"."learners" l
 where coalesce(btrim(l.cohort_id), '') <> ''
   and not exists (select 1 from "curriculum"."cohorts" c where c.cohort_id = l.cohort_id)
union all
select 'group_id points at no group', l.id, l.group_id, l.cohort_id
  from "Learner"."learners" l
 where coalesce(btrim(l.group_id), '') <> ''
   and not exists (select 1 from "curriculum"."groups" g where g.group_id = l.group_id)
union all
select 'group is not in the linked cohort', l.id, l.group_id, l.cohort_id
  from "Learner"."learners" l
  join "curriculum"."groups" g on g.group_id = l.group_id
 where coalesce(btrim(l.cohort_id), '') <> ''
   and coalesce(btrim(g.cohort_id), '') <> ''
   and g.cohort_id <> l.cohort_id
 order by problem, learner_id;
