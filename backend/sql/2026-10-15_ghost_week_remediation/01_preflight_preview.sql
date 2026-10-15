-- Ghost week remediation -- step 1: preflight preview. READ ONLY.
--
-- Two running "AI In Marketing" modules (G3-Sharon Friday ...A499 and
-- G2-Sharon Wednesday ...43D0) each still hold 17 weeks from a module delete on
-- 21 Sep 2026 that was later undone without them. Those weeks are stamped
-- deleted_via_parent = <their own module id>, which (a) let learner/coach
-- reads show them as if they were the archived module's history, and (b) would
-- revive them as live weeks if the module were ever archived and restored
-- (restore matches on that stamp).
--
-- 02_apply_weeks.sql clears ONLY deleted_via_parent on exactly these 34 rows,
-- and 03_apply_components.sql does the same for the 594 components that sat on
-- them. They stay deleted (deleted_at, deleted_by, is_programme_deleted are
-- untouched); they simply stop claiming a module cascade they no longer belong
-- to. Nothing is hard-deleted.
--
-- Every query below is a SELECT. Expected results are noted on each.

-- 1. The 34 target rows. EXPECT 34 rows, every one: module_active = true,
--    stamp_is_own_module = true, deleted_by = 'module-delete'.
select w.module_catalogue_id,
       w.week_number,
       w.id,
       w.title,
       w.deleted_at,
       w.deleted_by,
       w.deleted_via_parent,
       w.is_programme_deleted,
       m.deleted_at is null                          as module_active,
       w.deleted_via_parent = w.module_catalogue_id  as stamp_is_own_module
  from curriculum.weeks w
  join curriculum.modules m on m.module_catalogue_id = w.module_catalogue_id
 where w.id in (
        'WEEK-202609210852197534Z3AYY','WEEK-20260921085219753NN14BT','WEEK-20260921085219754U09HWK',
        'WEEK-20260921085219755QKPMJT','WEEK-202609210852197560MRNXV','WEEK-20260921085219757VR1FX5',
        'WEEK-20260921085219758U5A4H9','WEEK-20260921085219758V9Q7K6','WEEK-20260921085219758EYXVQG',
        'WEEK-20260921085219759UAVCPH','WEEK-202609210852197593ZJ9QL','WEEK-20260921085219759795YHG',
        'WEEK-20260921085219760UY99E3','WEEK-20260921085219760BGFA0P','WEEK-20260921085219760CM59KW',
        'WEEK-20260921085219760R3XCT9','WEEK-20260921085219761856INC',
        'WEEK-20260921085236476XWAXGP','WEEK-20260921085236476CM83GA','WEEK-20260921085236477RU795F',
        'WEEK-20260921085236477FLW4AA','WEEK-2026092108523647788GZII','WEEK-20260921085236478VF5N7J',
        'WEEK-20260921085236478MV587R','WEEK-20260921085236478BRIUKI','WEEK-20260921085236478MSXSJW',
        'WEEK-20260921085236481ZMIUOG','WEEK-20260921085236481U3TEJW','WEEK-202609210852364811G7VKK',
        'WEEK-20260921085236481VIBMMU','WEEK-20260921085236481N0M2GU','WEEK-20260921085236481N1H4OM',
        'WEEK-20260921085236482FKK7H3','WEEK-20260921085236482NZOMXE')
 order by w.module_catalogue_id, w.week_number;

-- 2. Independent discovery: every deleted week in a RUNNING module that still
--    claims a parent cascade. EXPECT exactly the same 34 ids as query 1 and no
--    other module. Anything else here means the data has moved since this
--    bundle was written -- stop and re-plan.
select w.module_catalogue_id, count(*) as rows,
       min(w.deleted_at) as first_deleted, max(w.deleted_at) as last_deleted
  from curriculum.weeks w
  join curriculum.modules m on m.module_catalogue_id = w.module_catalogue_id
 where m.deleted_at is null
   and w.deleted_at is not null
   and coalesce(w.deleted_via_parent, '') <> ''
 group by w.module_catalogue_id
 order by w.module_catalogue_id;

-- 3. The live structure the learner should see instead (what the Module
--    Builder shows). EXPECT 16 live weeks per module, numbered 1..16.
select w.module_catalogue_id, count(*) as live_weeks,
       min(w.week_number) as first_week, max(w.week_number) as last_week
  from curriculum.weeks w
 where w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                 'MOD-20260921085233798880517CB0D243D0')
   and w.deleted_at is null
 group by w.module_catalogue_id;

-- 4. What is attached to the target rows (context only; NOT changed by this
--    bundle). EXPECT 297 deleted components per module, 0 live components,
--    0 KSB mappings. Learner progress, attendance and KSB records are keyed to
--    components/occurrences, not to these week rows, and are not touched.
select w.module_catalogue_id,
       count(c.id) filter (where c.deleted_at is null)     as live_components,
       count(c.id) filter (where c.deleted_at is not null) as deleted_components,
       (select count(*) from curriculum.ksb_mappings k
         where k.week_id = any(array_agg(w.id)))           as ksb_mappings
  from curriculum.weeks w
  left join curriculum.components c on c.week_id = w.id
 where w.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                 'MOD-20260921085233798880517CB0D243D0')
   and w.deleted_at is not null
   and w.deleted_via_parent = w.module_catalogue_id
 group by w.module_catalogue_id;

-- 5. The 594 components 03_apply_components.sql targets. EXPECT exactly two
--    rows: 297 per module, ids_md5 7636d6ce7129d3bc0e654ba691d80e16 (...A499)
--    and e4bbcab150e966907e66dad85a3ee931 (...43D0), each on 17 ghost weeks,
--    deleted 08:53 on 21 Sep 2026 by 'module-delete'.
select c.module_catalogue_id,
       count(*)                                      as components,
       md5(string_agg(c.id, ',' order by c.id))      as ids_md5,
       count(distinct c.week_id)                     as weeks,
       min(c.deleted_at)                             as first_deleted,
       max(c.deleted_at)                             as last_deleted,
       string_agg(distinct c.deleted_by, ',')        as deleted_by
  from curriculum.components c
  join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
 where m.deleted_at is null
   and c.deleted_at is not null
   and coalesce(c.deleted_via_parent, '') <> ''
 group by c.module_catalogue_id
 order by c.module_catalogue_id;

-- 6. Nothing a learner holds points at those components. EXPECT every count 0.
with g as (
    select c.id from curriculum.components c
     where c.module_catalogue_id in ('MOD-20260921085217095815146F2085A499',
                                     'MOD-20260921085233798880517CB0D243D0')
       and c.deleted_at is not null
       and c.deleted_via_parent = c.module_catalogue_id)
select (select count(*) from "Learner".learner_training_plan_components p
         where p.curriculum_component_id in (select id from g))           as plan_components,
       (select count(*) from curriculum.quiz_component_links q
         where q.component_id in (select id from g))                      as quiz_links,
       (select count(*) from curriculum.ksb_mappings k
         where k.component_id in (select id from g))                      as ksb_mappings,
       (select count(*) from "Engagement".shared_reward_sessions s
         where s.component_id in (select id from g))                      as reward_sessions;

-- 7. What a module Restore would bring back today (rows stamped with the
--    module's own id). EXPECT per module: weeks 17, components 297,
--    module_completion_criteria 1, module_details 1. The last two are each
--    module's only row of that kind, so reviving them is correct and this
--    bundle leaves them alone.
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

-- 8. Not yet applied. EXPECT 0 and 0 (or "relation does not exist" on a first
--    run -- run each line on its own if so).
select count(*) as weeks_already_backed_up from week_ghost_remediation.weeks_before;
select count(*) as components_already_backed_up from week_ghost_remediation.components_before;
