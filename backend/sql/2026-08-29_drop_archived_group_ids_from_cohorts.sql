-- Cleanup for the "recreate an archived group" bug (curriculum_api.views
-- create_curriculum_group). Before the fix, a create that matched an archived
-- group took the update branch and re-added that archived group_id to its
-- cohort's denormalized group_ids array. The array feeds cohort.groups in the
-- payload, which is what the Programme and Cohort pages count, so an affected
-- cohort reports more groups than it lists.
--
-- Safe to re-run. Reads only; writes nothing but the group_ids array, and only
-- on cohorts that actually hold a soft-deleted group id.

-- 1. Inspect first: which cohorts are affected, and by which dead ids.
select c.cohort_id,
       c.cohort_name,
       c.programme_name,
       array_agg(dead.group_id) as archived_group_ids_listed
  from curriculum.cohorts c
  join lateral jsonb_array_elements_text(coalesce(c.group_ids, '[]'::jsonb)) as listed(group_id)
    on true
  join curriculum.groups dead
    on dead.group_id = listed.group_id
   and (dead.deleted_at is not null or dead.is_programme_deleted is true)
 where c.deleted_at is null
 group by c.cohort_id, c.cohort_name, c.programme_name
 order by c.programme_name, c.cohort_name;

-- 2. Apply: rebuild group_ids from the entries that are not soft-deleted.
update curriculum.cohorts c
   set group_ids = coalesce(
         (select jsonb_agg(listed.group_id order by listed.ord)
            from jsonb_array_elements_text(coalesce(c.group_ids, '[]'::jsonb))
                 with ordinality as listed(group_id, ord)
           where not exists (
                 select 1
                   from curriculum.groups g
                  where g.group_id = listed.group_id
                    and (g.deleted_at is not null or g.is_programme_deleted is true)
           )),
         '[]'::jsonb
       ),
       updated_at = now()
 where c.deleted_at is null
   and exists (
       select 1
         from jsonb_array_elements_text(coalesce(c.group_ids, '[]'::jsonb)) as listed(group_id)
         join curriculum.groups g
           on g.group_id = listed.group_id
          and (g.deleted_at is not null or g.is_programme_deleted is true)
   );
