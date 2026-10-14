-- KSB standards migration -- unresolved records for manual review (READ-ONLY).
-- Run after 01_plan.sql (before or after 02_apply.sql). Writes nothing.

-- (1) Group-heading mappings (B1-B4 in Marketing Executive Level 4), one row
--     per mapping: where it sits, the original KSB, the standard KSBs its own
--     points map to (candidates only -- nothing is converted automatically),
--     and how many learners completed that component.
select coalesce(pr.name, mp.programme_id)                          as programme,
       mo.title                                                    as module,
       coalesce(nullif(w.title, ''), 'Week ' || w.week_number)     as week,
       c.title                                                     as component,
       mp.mapping_id,
       mp.row_deleted                                              as mapping_already_deleted,
       mp.old_code                                                 as original_ksb,
       h.manual_desc                                               as original_ksb_text,
       (select string_agg(i.manual_code || ' -> ' || i.std_code || ' ' || left(i.std_desc, 60), ' | ' order by i.pos)
          from ksb_mig.item_match i
         where i.profile_id = mp.profile_id and i.manual_code like mp.old_code || '.%')
                                                                   as proposed_standard_alternatives,
       (select count(distinct e.learner_id) from "Learner".learner_progress_entries e
         where e.component_ref = mp.component_id and e.deleted_at is null
           and e.passed is not false and (lower(coalesce(e.kind, '')) <> 'quiz' or e.passed is true))
                                                                   as learners_completed_component
from ksb_mig.mapping_plan mp
left join ksb_mig.item_match h on h.profile_id = mp.profile_id and h.manual_code = upper(btrim(mp.old_code))
left join curriculum.modules mo on mo.module_catalogue_id = mp.module_catalogue_id
left join curriculum.weeks w on w.id = mp.week_id
left join curriculum.components c on c.id = mp.component_id
left join curriculum.programmes pr on pr.programme_id = mp.programme_id
where mp.action = 'review_group_heading'
order by mp.row_deleted, mo.title, w.week_number, c.title, mp.old_code;

-- (2) Coverage view for the migrated programme(s): per standard KSB, whether it
--     has ACTIVE standard coverage after the migration, coverage only through
--     an UNRESOLVED heading, or none.
select s.sid, s.std_code, left(s.std_desc, 70) as standard_ksb,
       (select count(*) from ksb_mig.mapping_plan p
         where p.std_sid = s.sid and p.std_code = s.std_code and p.action = 'repoint' and not p.row_deleted) as active_mappings,
       (select count(*) from ksb_mig.mapping_plan p
         join ksb_mig.item_match i on i.profile_id = p.profile_id and i.std_code = s.std_code
         where p.action = 'review_group_heading' and not p.row_deleted
           and i.manual_code like upper(btrim(p.old_code)) || '.%') as unresolved_heading_mappings,
       case when exists (select 1 from ksb_mig.mapping_plan p where p.std_sid = s.sid and p.std_code = s.std_code
                          and p.action = 'repoint' and not p.row_deleted) then 'active'
            when exists (select 1 from ksb_mig.mapping_plan p
                          join ksb_mig.item_match i on i.profile_id = p.profile_id and i.std_code = s.std_code
                         where p.action = 'review_group_heading' and not p.row_deleted
                           and i.manual_code like upper(btrim(p.old_code)) || '.%') then 'unresolved_only'
            else 'none' end as coverage
from ksb_mig.std s
where s.sid in (select std_sid from ksb_mig.programme_scope where decision = 'migrate')
order by s.sid, left(s.std_code, 1) desc, length(s.std_code), s.std_code;

-- (3) Learner rows kept unchanged but registered as not counting, by reason.
select status, source_type, source_system, count(*) as rows_, count(distinct learner_id) as learners
from ksb_mig.legacy_rows where status not in ('valid_standard_text', 'valid_ssot_code')
group by 1, 2, 3
union all
select case action when 'review_group_heading' then 'excluded_group_heading (plan)'
                   when 'review_no_profile' then 'excluded_orphan (plan)' else 'excluded_unresolved (plan)' end,
       coalesce(old_source_type, ''), '', count(*), count(distinct learner_id)
from ksb_mig.progress_plan where action in ('review_group_heading', 'review_unresolved', 'review_no_profile')
group by 1, 2
order by 1;
