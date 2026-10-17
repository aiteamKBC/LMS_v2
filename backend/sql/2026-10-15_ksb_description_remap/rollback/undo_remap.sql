-- Undo the KSB description remap (02_apply.sql).
--
-- Required first, in the same session:
--   SET ksb_remap.rollback = 'yes';
--
-- Restores every logged value that still holds exactly what the remap wrote.
-- A value someone changed after the remap is reported as a conflict and left
-- as it is. One learner_activity_revisions row per restored activity.

begin;

create function pg_temp.undo_guard() returns void language plpgsql as $g$
begin
  if coalesce(current_setting('ksb_remap.rollback', true), '') <> 'yes' then
    raise exception 'refusing: SET ksb_remap.rollback = ''yes'' first';
  end if;
  if to_regclass('ksb_migration_archive.description_remap_log') is null then
    raise exception 'nothing to undo: ksb_migration_archive.description_remap_log does not exist';
  end if;
end $g$;
select pg_temp.undo_guard();

do $undo$
declare
  v_ref text := 'ksb-description-remap-2026-10-15:undo:' || to_char(now(), 'YYYYMMDDHH24MISS');
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  create temp table undo_progress on commit drop as
  select l.id as log_id, split_part(l.record_key, ':', 1)::bigint as progress_id, split_part(l.record_key, ':', 2)::int as position,
         l.before_value, l.after_value,
         (k.ksb_code = l.after_value->>'ksb_code'
          and k.ksb_description is not distinct from l.after_value->>'ksb_description'
          and k.ksb_definition_id is not distinct from (l.after_value->>'ksb_definition_id')::bigint) as unchanged
  from ksb_migration_archive.description_remap_log l
  left join "Learner".learner_progress_ksbs k
    on k.progress_id = split_part(l.record_key, ':', 1)::bigint and k.position = split_part(l.record_key, ':', 2)::int
  where l.kind = 'progress' and l.rolled_back_at is null;

  with snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object('position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
                                        'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
                                        'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object('position', k.position,
                                        'ksb_code', coalesce(u.before_value->>'ksb_code', k.ksb_code),
                                        'ksb_description', case when u.log_id is not null then u.before_value->>'ksb_description' else k.ksb_description end,
                                        'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
                                        'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    left join undo_progress u on u.progress_id = k.progress_id and u.position = k.position and u.unchanged
    where k.progress_id in (select progress_id from undo_progress where unchanged)
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-description-remap', v_ref || ':progress:' || e.id,
         'ksb_description_remap_undo', jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-description-remap'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;

  update "Learner".learner_progress_ksbs k
     set ksb_code = u.before_value->>'ksb_code',
         ksb_description = u.before_value->>'ksb_description',
         ksb_definition_id = (u.before_value->>'ksb_definition_id')::bigint
    from undo_progress u
   where u.unchanged and k.progress_id = u.progress_id and k.position = u.position;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('progress_restored', v_n);

  update ksb_migration_archive.description_remap_log l set rolled_back_at = now()
    from undo_progress u where u.unchanged and l.id = u.log_id;
  v_counts := v_counts || jsonb_build_object('progress_conflicts', (select count(*) from undo_progress where not coalesce(unchanged, false)));

  -- Journal lists: restored only while they hold exactly what the remap wrote.
  create temp table undo_journal on commit drop as
  select l.id as log_id, l.table_name, l.record_key, l.before_value, l.after_value, false as done
  from ksb_migration_archive.description_remap_log l
  where l.kind = 'journal' and l.rolled_back_at is null;

  update "Learner".learner_journal_row_ksbs t set ksbs = u.before_value, version = t.version + 1,
         updated_by = 'ksb-description-remap-undo', updated_at = now()
    from undo_journal u
   where u.table_name = 'Learner.learner_journal_row_ksbs' and t.row_id::text = u.record_key and t.ksbs = u.after_value;
  update structured_manual_activities.learner_journal_row_ksbs t set ksbs = u.before_value, version = t.version + 1,
         updated_by = 'ksb-description-remap-undo', updated_at = now()
    from undo_journal u
   where u.table_name = 'structured_manual_activities.learner_journal_row_ksbs' and t.row_id::text = u.record_key and t.ksbs = u.after_value;
  update "Learner".learner_activity_ksbs t set ksbs = u.before_value, version = t.version + 1,
         updated_by = 'ksb-description-remap-undo', updated_at = now()
    from undo_journal u
   where u.table_name = 'Learner.learner_activity_ksbs' and t.aptem_id::text || ':' || t.activity_id::text = u.record_key and t.ksbs = u.after_value;
  update structured_manual_activities.learner_activity_ksbs t set ksbs = u.before_value, version = t.version + 1,
         updated_by = 'ksb-description-remap-undo', updated_at = now()
    from undo_journal u
   where u.table_name = 'structured_manual_activities.learner_activity_ksbs' and t.aptem_id::text || ':' || t.activity_id::text = u.record_key and t.ksbs = u.after_value;

  -- A journal row counts as restored when it now holds the before value.
  update undo_journal u set done = true
   where exists (
     select 1 from (
       select 'Learner.learner_journal_row_ksbs' as tbl, row_id::text as row_key, ksbs from "Learner".learner_journal_row_ksbs
       union all select 'structured_manual_activities.learner_journal_row_ksbs', row_id::text, ksbs from structured_manual_activities.learner_journal_row_ksbs
       union all select 'Learner.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from "Learner".learner_activity_ksbs
       union all select 'structured_manual_activities.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from structured_manual_activities.learner_activity_ksbs
     ) s where s.tbl = u.table_name and s.row_key = u.record_key and s.ksbs = u.before_value);
  update ksb_migration_archive.description_remap_log l set rolled_back_at = now()
    from undo_journal u where u.done and l.id = u.log_id;
  v_counts := v_counts || jsonb_build_object('journal_restored', (select count(*) from undo_journal where done),
                                             'journal_conflicts', (select count(*) from undo_journal where not done));

  raise notice 'ksb description remap undone: %', v_counts;
end
$undo$;

commit;
