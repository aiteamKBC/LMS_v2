-- Ghost week remediation -- step 4: verify. READ ONLY.

-- 1. Before-image recorded. EXPECT 34 rows: 17 per module.
select module_catalogue_id, count(*) as backed_up
  from week_ghost_remediation.weeks_before
 group by module_catalogue_id order by module_catalogue_id;

-- 2. The 34 rows: still deleted, same deleted_at/deleted_by, stamp cleared.
--    EXPECT 34 rows, every flag true.
select w.id,
       w.deleted_at is not null                 as still_deleted,
       w.deleted_at = b.deleted_at              as same_deleted_at,
       w.deleted_by is not distinct from b.deleted_by as same_deleted_by,
       w.deleted_via_parent is null             as stamp_cleared,
       w.title = b.title                        as same_title
  from week_ghost_remediation.weeks_before b
  join curriculum.weeks w on w.id = b.id
 order by b.module_catalogue_id, b.week_number;

-- 3. No running module anywhere still holds a deleted week that claims a
--    parent cascade. EXPECT 0 rows.
select w.module_catalogue_id, count(*)
  from curriculum.weeks w
  join curriculum.modules m on m.module_catalogue_id = w.module_catalogue_id
 where m.deleted_at is null and w.deleted_at is not null
   and coalesce(w.deleted_via_parent, '') <> ''
 group by w.module_catalogue_id;

-- 4. Learner-facing week structure equals the Module Builder's (live weeks,
--    first per number). EXPECT 16 rows per module with old_rule_id = live_id.
--    "old_rule" is the pre-fix reader filter: once the stamps are cleared it
--    returns the live structure too, so the data is right even for a backend
--    that has not been redeployed yet.
with old_rule as (
    select distinct on (w.module_catalogue_id, w.week_number)
           w.module_catalogue_id, w.week_number, w.id, w.title
      from curriculum.weeks w
     where w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                     'MOD-20260921085233798880517CB0D243D0')
       and (w.deleted_at is null or coalesce(w.deleted_via_parent, '') <> '')
     order by w.module_catalogue_id, w.week_number, w.display_order, w.id),
live as (
    select distinct on (w.module_catalogue_id, w.week_number)
           w.module_catalogue_id, w.week_number, w.id, w.title
      from curriculum.weeks w
     where w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                     'MOD-20260921085233798880517CB0D243D0')
       and w.deleted_at is null
     order by w.module_catalogue_id, w.week_number, w.display_order, w.id)
select coalesce(o.module_catalogue_id, l.module_catalogue_id) as module,
       coalesce(o.week_number, l.week_number)                 as week_number,
       o.title as old_rule_title, l.title as live_title,
       o.id is not distinct from l.id                         as old_rule_id_eq_live_id
  from old_rule o full join live l
    on l.module_catalogue_id = o.module_catalogue_id and l.week_number = o.week_number
 order by 1, 2;

-- 5. Components on the 34 weeks: still deleted, none revived. EXPECT 297
--    deleted and 0 live per module.
select b.module_catalogue_id,
       count(c.id) filter (where c.deleted_at is null)     as live_components,
       count(c.id) filter (where c.deleted_at is not null) as deleted_components
  from week_ghost_remediation.weeks_before b
  left join curriculum.components c on c.week_id = b.id
 group by b.module_catalogue_id;

-- 6. The 594 components: still deleted, same deleted_at/deleted_by, stamp
--    cleared. EXPECT one row per module, every count 297.
select b.module_catalogue_id,
       count(*)                                                        as rows,
       count(*) filter (where c.deleted_at is not null)                as still_deleted,
       count(*) filter (where c.deleted_at = b.deleted_at)             as same_deleted_at,
       count(*) filter (where c.deleted_by is not distinct from b.deleted_by) as same_deleted_by,
       count(*) filter (where c.deleted_via_parent is null)            as stamp_cleared
  from week_ghost_remediation.components_before b
  join curriculum.components c on c.id = b.id
 group by b.module_catalogue_id;

-- 7. What a module Restore would bring back now. EXPECT no weeks or
--    components rows; module_completion_criteria 1 and module_details 1 per
--    module remain (each module's only row of that kind -- correct to revive).
select t.tbl, t.module_catalogue_id, count(*) as restore_would_revive
  from (select 'weeks' as tbl, module_catalogue_id, deleted_via_parent from curriculum.weeks
        union all select 'components', module_catalogue_id, deleted_via_parent from curriculum.components
        union all select 'ksb_mappings', module_catalogue_id, deleted_via_parent from curriculum.ksb_mappings
        union all select 'module_completion_criteria', module_catalogue_id, deleted_via_parent from curriculum.module_completion_criteria
        union all select 'module_details', module_catalogue_id, deleted_via_parent from curriculum.module_details) t
 where t.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                 'MOD-20260921085233798880517CB0D243D0')
   and t.deleted_via_parent = t.module_catalogue_id
 group by t.tbl, t.module_catalogue_id
 order by t.module_catalogue_id, t.tbl;
