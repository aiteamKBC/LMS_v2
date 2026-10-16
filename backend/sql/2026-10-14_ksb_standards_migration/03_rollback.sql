-- KSB standards migration -- step 3 (only if needed): roll the apply back.
--
-- Restores, from schema ksb_migration_archive, every value 02_apply.sql
-- changed: mappings (table + component JSON), learner progress KSB rows,
-- learner pins, programme/module sources. Removes the exclusion-registry rows
-- of the run and the learner KSB versions the run created (only when nothing
-- references them any more). Writes one learner_activity_revisions row per
-- restored activity, so the audit trail shows both directions.
--
-- Safety: a row is restored only while it still holds exactly the value the
-- apply wrote. Rows changed by the application since the apply are CONFLICTS:
-- by default the rollback aborts and lists them; with
--   SET ksb_mig.rollback_skip_conflicts = 'on';
-- it restores everything else and leaves the conflicting rows as they are
-- (they are listed in ksb_migration_archive.rollback_conflicts).
--
-- Second safety net: the Neon branch/snapshot taken before the apply.
-- The archive schema is kept after a rollback (it is the audit trail).
-- Idempotent: a second run finds status 'rolled_back' and does nothing.

begin;

do $rb$
declare
  v_run constant text := 'ksb-standards-2026-10-14';
  v_skip boolean := coalesce(current_setting('ksb_mig.rollback_skip_conflicts', true), '') = 'on';
  v_status text;
  v_attempt integer;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  if to_regclass('ksb_migration_archive.run_log') is null then
    raise exception 'nothing to roll back: ksb_migration_archive.run_log does not exist';
  end if;
  select status, attempt into v_status, v_attempt from ksb_migration_archive.run_log where run_id = v_run;
  if v_status is null then raise exception 'run % not found', v_run; end if;
  if v_status = 'rolled_back' then
    raise notice 'run % is already rolled back; nothing to do', v_run;
    return;
  end if;
  if v_status <> 'applied' then raise exception 'run % is in state %, not applied', v_run, v_status; end if;
  if to_regclass('ksb_migration_archive.plan_mapping') is null then
    raise exception 'the frozen plan of run % is missing from ksb_migration_archive', v_run;
  end if;
  -- 04_pin_remediation_plan.sql PART B pins learners to this run's standard
  -- version. Rolling the run back first would leave them on a version whose
  -- programme has gone back to its manual profile, and keep that version alive.
  if to_regclass('ksb_migration_archive.pin_fix_before') is not null then
    select count(*) into v_n
      from "Learner".learner_ksb_assignments a
      join ksb_migration_archive.pin_fix_before f on f.learner_id = a.learner_id
      join ksb_migration_archive.versions_created c on c.profile_version_id = a.profile_version_id and c.run_id = v_run;
    if v_n > 0 then
      raise exception 'roll back 04_pin_remediation_plan.sql PART B first: % learners it repinned still use this run''s standard version', v_n;
    end if;
  end if;
  -- 07_orphan_recovery.sql translates rows this run registered; this rollback
  -- would delete their registry entries and leave the translated rows behind.
  -- Nested: PL/pgSQL parses the whole condition, so the table must exist
  -- before the query that reads it is even prepared (07 may never have run).
  if to_regclass('ksb_migration_archive.orphan_fix_before') is not null then
    if exists (select 1 from ksb_migration_archive.orphan_fix_before where rolled_back_at is null) then
      raise exception 'roll back 07_orphan_recovery.sql first (07b_orphan_recovery_rollback.sql)';
    end if;
  end if;

  -- ------------------------------------------------------------- conflicts
  create table if not exists ksb_migration_archive.rollback_conflicts (
    run_id text, object text, key text, detected_at timestamptz default now());
  delete from ksb_migration_archive.rollback_conflicts where run_id = v_run;

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'ksb_mapping', b.id
  from ksb_migration_archive.mappings_before b
  join curriculum.ksb_mappings m on m.id = b.id
  left join ksb_migration_archive.plan_mapping p on p.mapping_id = b.id
  where not (
          (p.action = 'repoint' and upper(m.ksb_code) = p.std_code and m.source_type = 'standard' and m.source_id = p.std_sid)
       or (p.action = 'review_group_heading' and m.ksb_code = b.ksb_code and m.source_id is not distinct from b.source_id
           and (m.deleted_by = 'ksb-standards-migration:unresolved-group-heading' or coalesce(b.is_programme_deleted, false)))
        );

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'component', a.id
  from ksb_migration_archive.components_after a
  join curriculum.components c on c.id = a.id
  where c.ksb_mappings is distinct from a.ksb_mappings;

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'learner_progress_ksb', b.progress_id || ':' || b.position
  from ksb_migration_archive.progress_ksbs_before b
  join ksb_migration_archive.plan_progress p on p.progress_id = b.progress_id and p.position = b.position
  left join "Learner".learner_progress_ksbs k on k.progress_id = b.progress_id and k.position = b.position
  where k.progress_id is null
     or not (k.ksb_code = p.std_code and k.source_type = 'standard' and k.source_id = p.std_sid);

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'pin', b.learner_id::text
  from ksb_migration_archive.pins_before b
  join "Learner".learner_ksb_assignments a on a.learner_id = b.learner_id
  join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
  where a.profile_version_id <> b.profile_version_id
    and not exists (select 1 from ksb_migration_archive.plan_pin pp where pp.learner_id = b.learner_id and v.source_profile_id = 'standard:' || pp.std_sid);

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'programme', b.programme_id
  from ksb_migration_archive.programmes_before b
  join curriculum.programmes p on p.programme_id = b.programme_id
  join ksb_migration_archive.plan_programme s on s.programme_id = b.programme_id
  where p.ksb_profile_source_id is distinct from 'standard:' || s.std_sid;

  insert into ksb_migration_archive.rollback_conflicts (run_id, object, key)
  select v_run, 'module', b.module_catalogue_id
  from ksb_migration_archive.modules_before b
  join curriculum.modules m on m.module_catalogue_id = b.module_catalogue_id
  join ksb_migration_archive.plan_programme s on s.programme_id = m.programme_id and s.decision = 'migrate'
  where m.ksb_profile_source_id is distinct from 'standard:' || s.std_sid;

  select count(*) into v_n from ksb_migration_archive.rollback_conflicts where run_id = v_run;
  v_counts := v_counts || jsonb_build_object('conflicts', v_n);
  if v_n > 0 and not v_skip then
    raise exception 'rollback aborted: % rows changed since the apply (see ksb_migration_archive.rollback_conflicts after a skip run, or query the conflict rules); set ksb_mig.rollback_skip_conflicts = on to restore everything else', v_n;
  end if;

  -- --------------------------------------------------------------- restore
  update curriculum.ksb_mappings m
     set ksb_code = b.ksb_code, ksb_id = b.ksb_id, ksb_description = b.ksb_description,
         source_type = b.source_type, source_id = b.source_id,
         is_programme_deleted = b.is_programme_deleted, deleted_at = b.deleted_at,
         deleted_by = b.deleted_by, deleted_via_parent = b.deleted_via_parent,
         updated_at = b.updated_at
    from ksb_migration_archive.mappings_before b
   where m.id = b.id
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'ksb_mapping' and x.key = b.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mappings_restored', v_n);

  update curriculum.components c
     set ksb_mappings = b.ksb_mappings
    from ksb_migration_archive.components_before b
   where c.id = b.id and c.ksb_mappings is distinct from b.ksb_mappings
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'component' and x.key = b.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('components_restored', v_n);

  with touched as (
    select distinct b.progress_id from ksb_migration_archive.progress_ksbs_before b
    where not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                      where x.run_id = v_run and x.object = 'learner_progress_ksb' and x.key = b.progress_id || ':' || b.position)
  ), snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', coalesce(b.ksb_code, k.ksb_code),
             'ksb_description', case when b.progress_id is null then k.ksb_description else b.ksb_description end,
             'source_type', case when b.progress_id is null then k.source_type else b.source_type end,
             'source_id', case when b.progress_id is null then k.source_id else b.source_id end,
             'classification', k.classification, 'weight', k.weight::float, 'weight_class', k.weight_class)
             order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    join touched t on t.progress_id = k.progress_id
    left join ksb_migration_archive.progress_ksbs_before b on b.progress_id = k.progress_id and b.position = k.position
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-standards-migration',
         v_run || ':a' || v_attempt || ':progress:' || e.id, 'ksb_standard_migration_rollback',
         jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-standards-migration'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('rollback_revisions_written', v_n);

  update "Learner".learner_progress_ksbs k
     set ksb_code = b.ksb_code, ksb_description = b.ksb_description,
         source_type = b.source_type, source_id = b.source_id, ksb_definition_id = b.ksb_definition_id
    from ksb_migration_archive.progress_ksbs_before b
   where k.progress_id = b.progress_id and k.position = b.position
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'learner_progress_ksb' and x.key = b.progress_id || ':' || b.position);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learner_ksb_rows_restored', v_n);

  if to_regclass('"Learner".learner_progress_ksb_exclusions') is not null then
    delete from "Learner".learner_progress_ksb_exclusions where run_id = v_run;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('exclusions_removed', v_n);
  end if;

  update "Learner".learner_ksb_assignments a
     set profile_version_id = b.profile_version_id, updated_at = b.updated_at
    from ksb_migration_archive.pins_before b
   where a.learner_id = b.learner_id and a.profile_version_id <> b.profile_version_id
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'pin' and x.key = b.learner_id::text);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pins_restored', v_n);

  update curriculum.programmes p
     set ksb_profile_source_id = b.ksb_profile_source_id, updated_at = b.updated_at
    from ksb_migration_archive.programmes_before b
   where p.programme_id = b.programme_id and p.ksb_profile_source_id is distinct from b.ksb_profile_source_id
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'programme' and x.key = b.programme_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('programmes_restored', v_n);

  update curriculum.modules m
     set ksb_profile_source_id = b.ksb_profile_source_id, updated_at = b.updated_at
    from ksb_migration_archive.modules_before b
   where m.module_catalogue_id = b.module_catalogue_id and m.ksb_profile_source_id is distinct from b.ksb_profile_source_id
     and not exists (select 1 from ksb_migration_archive.rollback_conflicts x
                     where x.run_id = v_run and x.object = 'module' and x.key = b.module_catalogue_id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modules_restored', v_n);

  -- Versions the run created, once nothing references them.
  delete from curriculum.ksb_definitions d
   using ksb_migration_archive.versions_created c
   where d.profile_version_id = c.profile_version_id and c.run_id = v_run
     and not exists (select 1 from "Learner".learner_ksb_assignments a where a.profile_version_id = c.profile_version_id)
     and not exists (select 1 from "Learner".learner_progress_ksbs k
                      join curriculum.ksb_definitions d2 on d2.id = k.ksb_definition_id
                     where d2.profile_version_id = c.profile_version_id);
  delete from curriculum.ksb_profile_versions v
   using ksb_migration_archive.versions_created c
   where v.id = c.profile_version_id and c.run_id = v_run
     and not exists (select 1 from "Learner".learner_ksb_assignments a where a.profile_version_id = v.id)
     and not exists (select 1 from curriculum.ksb_definitions d where d.profile_version_id = v.id);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('versions_removed', v_n);
  delete from ksb_migration_archive.versions_created c
   where c.run_id = v_run and not exists (select 1 from curriculum.ksb_profile_versions v where v.id = c.profile_version_id);

  update ksb_migration_archive.run_log
     set status = 'rolled_back', rolled_back_at = now(),
         counts = counts || jsonb_build_object('rollback_a' || v_attempt, v_counts)
   where run_id = v_run;
  raise notice 'ksb standards migration rolled back: %', v_counts;
end
$rb$;

commit;
