-- Rollback of 07_orphan_recovery.sql PART B (only if needed).
--
-- Order when undoing everything: this file, then 04b_pin_remediation_rollback.sql,
-- then 03_rollback.sql. 03_rollback.sql refuses while recovered rows remain.
--
-- Restores each recovered learner KSB row from ksb_migration_archive.orphan_fix_before
-- only while it still holds exactly the value 07 wrote; a row the application
-- has changed since is a CONFLICT and is left as it is (listed by a notice).
-- Re-registers the row as 'excluded_orphan' with its original reason, and
-- writes one learner_activity_revisions row per restored activity.
-- Runs only when explicitly confirmed:
--   SET ksb_orphan_fix.rollback = 'yes';
-- Idempotent: rolled-back rows are marked and skipped on a second run.

begin;
do $orphan_rb$
declare
  v_run constant text := 'ksb-standards-2026-10-14';
  v_ref text;
  v_n bigint;
begin
  if coalesce(current_setting('ksb_orphan_fix.rollback', true), '') <> 'yes' then
    raise notice 'skipped: set ksb_orphan_fix.rollback = yes to roll back the orphan recovery';
    return;
  end if;
  if to_regclass('ksb_migration_archive.orphan_fix_before') is null then
    raise notice 'nothing to roll back: 07_orphan_recovery.sql PART B never ran';
    return;
  end if;

  create temp table ksb_orphan_restore on commit drop as
  select b.* from ksb_migration_archive.orphan_fix_before b
  join "Learner".learner_progress_ksbs k on k.progress_id = b.progress_id and k.position = b.position
  where b.rolled_back_at is null
    and k.ksb_code = b.std_code and k.source_type = 'standard' and k.source_id = b.std_sid;

  select count(*) into v_n from ksb_migration_archive.orphan_fix_before b
   where b.rolled_back_at is null
     and not exists (select 1 from ksb_orphan_restore r where r.progress_id = b.progress_id and r.position = b.position);
  if v_n > 0 then
    raise notice '% recovered rows changed since the recovery: left as they are (conflicts)', v_n;
  end if;

  v_ref := v_run || ':orphan-rollback:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MISS');
  with touched as (
    select distinct progress_id from ksb_orphan_restore
  ), snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object(
             'position', k.position,
             'ksb_code', case when r.progress_id is null then k.ksb_code else r.ksb_code end,
             'ksb_description', case when r.progress_id is null then k.ksb_description else r.ksb_description end,
             'source_type', case when r.progress_id is null then k.source_type else r.source_type end,
             'source_id', case when r.progress_id is null then k.source_id else r.source_id end,
             'classification', k.classification, 'weight', k.weight::float, 'weight_class', k.weight_class)
             order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    join touched u on u.progress_id = k.progress_id
    left join ksb_orphan_restore r on r.progress_id = k.progress_id and r.position = k.position
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-standards-migration',
         v_ref || ':progress:' || e.id, 'ksb_orphan_recovery_rollback',
         jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-standards-migration'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;

  update "Learner".learner_progress_ksbs k
     set ksb_code = r.ksb_code, ksb_description = r.ksb_description,
         source_type = r.source_type, source_id = r.source_id, ksb_definition_id = r.ksb_definition_id
    from ksb_orphan_restore r
   where k.progress_id = r.progress_id and k.position = r.position;
  get diagnostics v_n = row_count;

  update "Learner".learner_progress_ksb_exclusions x
     set status = 'excluded_orphan', reason = r.exclusion_reason
    from ksb_orphan_restore r
   where x.progress_id = r.progress_id and x.position = r.position and x.run_id = v_run;

  update ksb_migration_archive.orphan_fix_before b
     set rolled_back_at = now()
    from ksb_orphan_restore r
   where b.progress_id = r.progress_id and b.position = r.position;

  raise notice 'orphan recovery rolled back: % learner KSB rows restored', v_n;
end
$orphan_rb$;
commit;
