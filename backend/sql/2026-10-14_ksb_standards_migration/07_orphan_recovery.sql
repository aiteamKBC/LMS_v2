-- Separate recovery: orphan learner KSB rows registered by 02_apply.sql.
--
-- NOT part of the KSB standards migration transaction. Run only after
-- 02_apply.sql AND 04_pin_remediation_plan.sql PART B, in the same
-- maintenance window, as its own transaction.
--
-- WHAT AN ORPHAN IS
--   A source-less dotted manual code (K1.2) on an activity with no programme,
--   whose learner was pinned to the mislabelled version 14 ('standard:st0845-v1-1'
--   holding the Marketing executive manual items -- READINESS_REPORT.md, section 6).
--   01_plan.sql cannot tell which manual profile the code belongs to, so
--   02_apply.sql leaves the row unchanged and registers it as 'excluded_orphan'.
--   On 14 Oct: progress 903190 (learner 571) K1.2, K2.2, K4.2. On 15 Oct a
--   fourth appeared: progress 910642 (learner 411) K4.3, written 14 Oct.
--
-- WHY IT IS SAFE TO TRANSLATE AFTER PART B
--   Part B repins the learner to the standard of the programme most of their
--   activity belongs to. Once the pin and that programme agree on a 'migrate'
--   programme, the manual profile is unambiguous, and the code translates by
--   the same description match (ksb_mig.item_match, status 'matched') every
--   other row used -- never by code. For Marketing executive:
--   K1.2 -> K2, K2.2 -> K5, K4.2 -> K10, K4.3 -> K11.
--   Where the activity names a component, that component must also belong to
--   the programme; otherwise the row is left alone.
--
-- PART A runs by default and is READ-ONLY: every registered orphan, with the
--   translation it would get or the reason it is held.
-- PART B changes data and runs only when explicitly confirmed:
--   SET ksb_orphan_fix.confirm = 'yes';
--   It repoints the ready rows, writes one learner_activity_revisions row per
--   activity, and RELEASES (never deletes) their registry entries. Prior values
--   are archived in ksb_migration_archive.orphan_fix_before. Idempotent.
-- Rollback: 07b_orphan_recovery_rollback.sql (before 04b / 03).

-- ------------------------------------------------------- PART A (read-only)
with registered as (
  select x.progress_id, x.position, x.ksb_code, x.status, k.source_type, e.learner_id, e.component_ref,
         a.profile_version_id, v.source_profile_id as pinned_label,
         (select programme_id from "Learner".learner_progress_entries e2
           where e2.learner_id = e.learner_id and coalesce(e2.programme_id, '') <> '' and e2.deleted_at is null
           group by programme_id order by count(*) desc, programme_id limit 1) as learner_programme
  from "Learner".learner_progress_ksb_exclusions x
  join "Learner".learner_progress_ksbs k on k.progress_id = x.progress_id and k.position = x.position
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  left join "Learner".learner_ksb_assignments a on a.learner_id = e.learner_id
  left join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
  where x.run_id = 'ksb-standards-2026-10-14' and x.status in ('excluded_orphan', 'released')
    and (x.status = 'excluded_orphan' or x.reason like '%07_orphan_recovery.sql%')
)
select r.progress_id, r.position, r.learner_id, r.ksb_code, r.pinned_label, r.learner_programme,
       s.std_sid, im.std_code, left(im.std_desc, 60) as std_desc,
       case when r.status = 'released' then 'already_recovered'
            when s.programme_id is null then 'held: learner programme is not a migrated programme'
            when r.pinned_label is distinct from 'standard:' || s.std_sid then 'held: pin not yet corrected (run 04 PART B)'
            when coalesce(r.source_type, '') <> '' then 'held: row has a source'
            when im.std_code is null then 'held: no matched description for this code'
            when r.component_ref is not null and not exists (
                   select 1 from curriculum.components c join curriculum.modules mo on mo.module_catalogue_id = c.module_catalogue_id
                    where c.id = r.component_ref and mo.programme_id = s.programme_id)
              then 'held: component belongs to another programme'
            else 'ready' end as decision
from registered r
left join ksb_migration_archive.plan_programme s on s.programme_id = r.learner_programme and s.decision = 'migrate'
left join ksb_mig.item_match im on im.profile_id = s.profile_id and im.manual_code = r.ksb_code and im.status = 'matched'
order by r.learner_id, r.progress_id, r.position;

-- ------------------------------------------- PART B (confirmed correction)
begin;
do $orphan$
declare
  v_run constant text := 'ksb-standards-2026-10-14';
  v_ref text;
  v_n bigint;
begin
  if coalesce(current_setting('ksb_orphan_fix.confirm', true), '') <> 'yes' then
    raise notice 'PART B skipped: set ksb_orphan_fix.confirm = yes to apply';
    return;
  end if;
  -- Nested: PL/pgSQL prepares a whole condition, so the run_log query must
  -- not be reached before its table is known to exist.
  if to_regclass('ksb_migration_archive.run_log') is null then
    raise exception 'run % is not applied: run 02_apply.sql first', v_run;
  end if;
  if (select status from ksb_migration_archive.run_log where run_id = v_run) is distinct from 'applied' then
    raise exception 'run % is not applied: run 02_apply.sql first', v_run;
  end if;

  create table if not exists ksb_migration_archive.orphan_fix_before (
    progress_id bigint not null, position integer not null, learner_id bigint not null,
    ksb_code varchar(64), ksb_description text, source_type text, source_id text, ksb_definition_id bigint,
    exclusion_reason text not null, std_sid text not null, std_code text not null, std_desc text,
    fixed_at timestamptz not null default now(), rolled_back_at timestamptz,
    primary key (progress_id, position));

  create temp table ksb_orphan_targets on commit drop as
  select k.progress_id, k.position, e.learner_id, k.ksb_code, k.ksb_description, k.source_type, k.source_id,
         k.ksb_definition_id, x.reason as exclusion_reason, s.std_sid, im.std_code, im.std_desc,
         a.profile_version_id as pin_version_id
  from "Learner".learner_progress_ksb_exclusions x
  join "Learner".learner_progress_ksbs k
    on k.progress_id = x.progress_id and k.position = x.position and upper(btrim(k.ksb_code)) = x.ksb_code
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  join "Learner".learner_ksb_assignments a on a.learner_id = e.learner_id
  join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
  join lateral (
    select programme_id from "Learner".learner_progress_entries e2
    where e2.learner_id = e.learner_id and coalesce(e2.programme_id, '') <> '' and e2.deleted_at is null
    group by programme_id order by count(*) desc, programme_id limit 1) lp on true
  join ksb_migration_archive.plan_programme s on s.programme_id = lp.programme_id and s.decision = 'migrate'
  join ksb_mig.item_match im on im.profile_id = s.profile_id and im.manual_code = x.ksb_code and im.status = 'matched'
  where x.run_id = v_run and x.status = 'excluded_orphan'
    and coalesce(k.source_type, '') = '' and coalesce(k.source_id, '') = ''
    and v.source_profile_id = 'standard:' || s.std_sid
    and (e.component_ref is null or exists (
          select 1 from curriculum.components c join curriculum.modules mo on mo.module_catalogue_id = c.module_catalogue_id
           where c.id = e.component_ref and mo.programme_id = s.programme_id));

  -- Archive. A row recovered, rolled back and recovered again is re-archived
  -- with its values as they are now.
  insert into ksb_migration_archive.orphan_fix_before
    (progress_id, position, learner_id, ksb_code, ksb_description, source_type, source_id, ksb_definition_id,
     exclusion_reason, std_sid, std_code, std_desc)
  select progress_id, position, learner_id, ksb_code, ksb_description, source_type, source_id, ksb_definition_id,
         exclusion_reason, std_sid, std_code, std_desc
  from ksb_orphan_targets
  on conflict (progress_id, position) do update
     set learner_id = excluded.learner_id, ksb_code = excluded.ksb_code, ksb_description = excluded.ksb_description,
         source_type = excluded.source_type, source_id = excluded.source_id, ksb_definition_id = excluded.ksb_definition_id,
         exclusion_reason = excluded.exclusion_reason, std_sid = excluded.std_sid, std_code = excluded.std_code,
         std_desc = excluded.std_desc, fixed_at = now(), rolled_back_at = null
   where ksb_migration_archive.orphan_fix_before.rolled_back_at is not null;

  -- One revision per activity, as 02_apply.sql writes them.
  v_ref := v_run || ':orphan:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MISS');
  with touched as (
    select distinct progress_id from ksb_orphan_targets
  ), snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object(
             'position', k.position,
             'ksb_code', coalesce(t.std_code, k.ksb_code),
             'ksb_description', case when t.progress_id is null then k.ksb_description else t.std_desc end,
             'source_type', case when t.progress_id is null then k.source_type else 'standard' end,
             'source_id', case when t.progress_id is null then k.source_id else t.std_sid end,
             'classification', k.classification, 'weight', k.weight::float, 'weight_class', k.weight_class)
             order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    join touched u on u.progress_id = k.progress_id
    left join ksb_orphan_targets t on t.progress_id = k.progress_id and t.position = k.position
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-standards-migration',
         v_ref || ':progress:' || e.id, 'ksb_orphan_recovery',
         jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-standards-migration'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;

  update "Learner".learner_progress_ksbs k
     set ksb_code = t.std_code,
         ksb_description = t.std_desc,
         source_type = 'standard',
         source_id = t.std_sid,
         ksb_definition_id = case when k.ksb_definition_id is null then null else (
           select d.id from curriculum.ksb_definitions d
            where d.profile_version_id = t.pin_version_id and d.code = t.std_code) end
    from ksb_orphan_targets t
   where k.progress_id = t.progress_id and k.position = t.position
     and upper(btrim(k.ksb_code)) = upper(btrim(t.ksb_code)) and coalesce(k.source_type, '') = '';
  get diagnostics v_n = row_count;

  update "Learner".learner_progress_ksb_exclusions x
     set status = 'released',
         reason = x.reason || ' | Released ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
                  || ' by 07_orphan_recovery.sql: translated to ' || t.std_sid || ' ' || t.std_code
                  || ' by description after the learner''s pin was corrected'
    from ksb_orphan_targets t
   where x.progress_id = t.progress_id and x.position = t.position and x.status = 'excluded_orphan';

  -- Post-check: every target now carries its standard code and is released.
  if exists (select 1 from ksb_orphan_targets t
               join "Learner".learner_progress_ksbs k on k.progress_id = t.progress_id and k.position = t.position
               join "Learner".learner_progress_ksb_exclusions x on x.progress_id = t.progress_id and x.position = t.position
              where not (k.ksb_code = t.std_code and k.source_type = 'standard' and k.source_id = t.std_sid
                         and x.status = 'released')) then
    raise exception 'post-check: an orphan row was not fully recovered';
  end if;
  raise notice 'orphan recovery: % learner KSB rows translated and released', v_n;
end
$orphan$;
commit;
