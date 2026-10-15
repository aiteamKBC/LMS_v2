-- KSB description remap -- step 2: apply the plan built by 01_plan.sql.
--
-- Run 01_plan.sql against the SAME database first and review
-- ksb_remap.mapping_report and ksb_remap.learner_effect.
--
-- What it changes (one transaction; any failed check changes nothing):
--   * "Learner".learner_progress_ksbs rows planned 'remap': ksb_code and
--     ksb_description become the standard KSB's, and ksb_definition_id (when
--     the row has one) the pinned standard version's definition of that code.
--     source_type, source_id, classification, weight, the progress entry, its
--     completion, timestamps and evidence links are NOT touched.
--     One "Learner".learner_activity_revisions row per changed activity.
--   * Journal KSB lists ("Learner" and structured_manual_activities
--     learner_journal_row_ksbs / learner_activity_ksbs): only the planned
--     array elements get the standard code and description; every other
--     element and key is kept as it is.
--   * Every changed value is logged (before and after) in
--     ksb_migration_archive.description_remap_log, for rollback/undo_remap.sql.
--
-- Idempotent: a row is changed only while it still holds its planned old
-- value, so a second run changes nothing.
--
-- Test hook: SET ksb_remap.fail_at = 'after_progress' | 'before_commit'.

begin;

create schema if not exists ksb_migration_archive;
create table if not exists ksb_migration_archive.description_remap_log (
  id bigserial primary key,
  run_id text not null,
  run_at timestamptz not null default now(),
  kind text not null check (kind in ('progress', 'journal')),
  table_name text not null,
  record_key text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  rolled_back_at timestamptz);

-- Rebuilds one journal KSB array: planned elements still holding their old
-- value get the standard code/description; everything else is copied as is.
create function pg_temp.ksb_remap_array(p_tbl text, p_key text, p_arr jsonb) returns jsonb
language sql stable as $f$
  select coalesce(jsonb_agg(
           case when j.action = 'remap' and x.e = j.old_item then
                  x.e || jsonb_build_object('description', j.std_desc)
                      || case when x.e ? 'code' then jsonb_build_object('code', j.std_code) else '{}'::jsonb end
                      || case when x.e ? 'ksbCode' then jsonb_build_object('ksbCode', j.std_code) else '{}'::jsonb end
                      || case when x.e ? 'ksb_code' then jsonb_build_object('ksb_code', j.std_code) else '{}'::jsonb end
                else x.e end
           order by x.ord), '[]'::jsonb)
  from jsonb_array_elements(p_arr) with ordinality as x(e, ord)
  left join ksb_remap.journal_plan j on j.tbl = p_tbl and j.row_key = p_key and j.idx = x.ord - 1
$f$;

do $remap$
declare
  v_run constant text := 'ksb-description-remap-2026-10-15';
  v_fail text := coalesce(current_setting('ksb_remap.fail_at', true), '');
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  -- ------------------------------------------------------------------ checks
  if to_regclass('ksb_remap.progress_plan') is null or to_regclass('ksb_remap.journal_plan') is null then
    raise exception 'ksb_remap plan tables are missing: run 01_plan.sql first';
  end if;
  if exists (select 1 from ksb_remap.progress_plan where action = 'remap'
               and (std_code is null or std_desc is null or n_cand <> 1 or std_code <> upper(std_code))) then
    raise exception 'plan has a remap without exactly one standard match';
  end if;

  -- Plan freshness: planned rows must still hold either the old or the new value.
  select count(*) into v_n from ksb_remap.progress_plan p
    left join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action = 'remap'
     and not coalesce((k.ksb_code = p.old_code_raw and k.ksb_description is not distinct from p.old_desc
                       and k.ksb_definition_id is not distinct from p.old_definition_id)
                   or (k.ksb_code = p.std_code and k.ksb_description = p.std_desc), false);
  if v_n > 0 then raise exception 'stale plan: % learner KSB rows changed since 01_plan.sql', v_n; end if;

  select count(*) into v_n from "Learner".learner_progress_ksbs k
    join "Learner".learner_progress_entries e on e.id = k.progress_id
    join ksb_remap.scope s on s.learner_id = e.learner_id
   where k.ksb_code ~ '^\s*[KSBksb][0-9]+\.[0-9]+\s*$'
     and not exists (select 1 from ksb_remap.progress_plan p where p.progress_id = k.progress_id and p.position = k.position);
  if v_n > 0 then raise exception 'stale plan: % new dotted learner KSB rows since 01_plan.sql', v_n; end if;

  -- --------------------------------------------------- learner progress KSBs
  create temp table remap_targets on commit drop as
  select p.* from ksb_remap.progress_plan p
    join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action = 'remap' and k.ksb_code = p.old_code_raw
     and k.ksb_description is not distinct from p.old_desc
     and k.ksb_definition_id is not distinct from p.old_definition_id;

  -- One revision per activity whose KSB snapshot changes, as curriculum sync does.
  with snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object(
             'position', k.position,
             'ksb_code', coalesce(t.std_code, k.ksb_code),
             'ksb_description', case when t.progress_id is not null then t.std_desc else k.ksb_description end,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    left join remap_targets t on t.progress_id = k.progress_id and t.position = k.position
    where k.progress_id in (select progress_id from remap_targets)
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-description-remap',
         v_run || ':' || to_char(now(), 'YYYYMMDDHH24MISS') || ':progress:' || e.id, 'ksb_description_remap',
         jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-description-remap'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_revisions_written', v_n);

  insert into ksb_migration_archive.description_remap_log (run_id, kind, table_name, record_key, before_value, after_value)
  select v_run, 'progress', 'Learner.learner_progress_ksbs', t.progress_id || ':' || t.position,
         jsonb_build_object('ksb_code', t.old_code_raw, 'ksb_description', t.old_desc, 'ksb_definition_id', t.old_definition_id),
         jsonb_build_object('ksb_code', t.std_code, 'ksb_description', t.std_desc,
                            'ksb_definition_id', case when t.old_definition_id is null then null else t.new_definition_id end)
  from remap_targets t;

  update "Learner".learner_progress_ksbs k
     set ksb_code = t.std_code,
         ksb_description = t.std_desc,
         ksb_definition_id = case when k.ksb_definition_id is null then null else t.new_definition_id end
    from remap_targets t
   where k.progress_id = t.progress_id and k.position = t.position
     and k.ksb_code = t.old_code_raw and k.ksb_description is not distinct from t.old_desc;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learner_ksb_rows_remapped', v_n);

  if v_fail = 'after_progress' then raise exception 'test hook: fail after progress'; end if;

  -- ------------------------------------------------------- journal KSB lists
  create temp table journal_targets on commit drop as
  select s.tbl, s.row_key, s.ksbs as before_ksbs, pg_temp.ksb_remap_array(s.tbl, s.row_key, s.ksbs) as after_ksbs
  from (
    select 'Learner.learner_journal_row_ksbs'::text as tbl, row_id::text as row_key, ksbs from "Learner".learner_journal_row_ksbs
    union all select 'structured_manual_activities.learner_journal_row_ksbs', row_id::text, ksbs from structured_manual_activities.learner_journal_row_ksbs
    union all select 'Learner.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from "Learner".learner_activity_ksbs
    union all select 'structured_manual_activities.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from structured_manual_activities.learner_activity_ksbs
  ) s
  where (s.tbl, s.row_key) in (select tbl, row_key from ksb_remap.journal_plan where action = 'remap');
  delete from journal_targets where after_ksbs = before_ksbs;

  update "Learner".learner_journal_row_ksbs t
     set ksbs = j.after_ksbs, version = t.version + 1, updated_by = 'ksb-description-remap', updated_at = now()
    from journal_targets j
   where j.tbl = 'Learner.learner_journal_row_ksbs' and t.row_id::text = j.row_key and t.ksbs = j.before_ksbs;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('journal_rows_learner', v_n);

  update structured_manual_activities.learner_journal_row_ksbs t
     set ksbs = j.after_ksbs, version = t.version + 1, updated_by = 'ksb-description-remap', updated_at = now()
    from journal_targets j
   where j.tbl = 'structured_manual_activities.learner_journal_row_ksbs' and t.row_id::text = j.row_key and t.ksbs = j.before_ksbs;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('journal_rows_coach', v_n);

  update "Learner".learner_activity_ksbs t
     set ksbs = j.after_ksbs, version = t.version + 1, updated_by = 'ksb-description-remap', updated_at = now()
    from journal_targets j
   where j.tbl = 'Learner.learner_activity_ksbs' and t.aptem_id::text || ':' || t.activity_id::text = j.row_key and t.ksbs = j.before_ksbs;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_ksbs_learner', v_n);

  update structured_manual_activities.learner_activity_ksbs t
     set ksbs = j.after_ksbs, version = t.version + 1, updated_by = 'ksb-description-remap', updated_at = now()
    from journal_targets j
   where j.tbl = 'structured_manual_activities.learner_activity_ksbs' and t.aptem_id::text || ':' || t.activity_id::text = j.row_key and t.ksbs = j.before_ksbs;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_ksbs_coach', v_n);

  insert into ksb_migration_archive.description_remap_log (run_id, kind, table_name, record_key, before_value, after_value)
  select v_run, 'journal', j.tbl, j.row_key, j.before_ksbs, j.after_ksbs from journal_targets j;
  -- ------------------------------------------------------------- post-checks
  select count(*) into v_n from ksb_remap.progress_plan p
    join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action = 'remap' and not (k.ksb_code = p.std_code and k.ksb_description = p.std_desc);
  if v_n > 0 then raise exception 'post-check: % planned learner rows were not remapped', v_n; end if;

  select count(*) into v_n from ksb_remap.progress_plan p
    join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action <> 'remap' and not (k.ksb_code = p.old_code_raw and k.ksb_description is not distinct from p.old_desc);
  if v_n > 0 then raise exception 'post-check: % rows outside the remap changed', v_n; end if;

  select count(*) into v_n from ksb_remap.journal_plan j
   where j.action = 'remap' and exists (
     select 1 from (
       select 'Learner.learner_journal_row_ksbs' as tbl, row_id::text as row_key, ksbs from "Learner".learner_journal_row_ksbs
       union all select 'structured_manual_activities.learner_journal_row_ksbs', row_id::text, ksbs from structured_manual_activities.learner_journal_row_ksbs
       union all select 'Learner.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from "Learner".learner_activity_ksbs
       union all select 'structured_manual_activities.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, ksbs from structured_manual_activities.learner_activity_ksbs
     ) s where s.tbl = j.tbl and s.row_key = j.row_key and s.ksbs -> j.idx::int = j.old_item);
  if v_n > 0 then raise exception 'post-check: % planned journal items still hold the manual code', v_n; end if;

  -- Every affected learner's achieved standard KSBs, recomputed from the live
  -- tables as the code-based readers count them (dotted code -> prefix), must
  -- equal the plan's AFTER side (ksb_remap.learner_effect.after_codes).
  with achieved as (
    select e.learner_id, regexp_replace(upper(btrim(k.ksb_code)), '\..*$', '') as code
    from "Learner".learner_progress_ksbs k
    join "Learner".learner_progress_entries e on e.id = k.progress_id
    where e.learner_id in (select learner_id from ksb_remap.learner_effect)
      and e.deleted_at is null and e.passed is not false
      and btrim(lower(coalesce(e.kind, ''))) <> 'activity_event'
      and (btrim(lower(coalesce(e.kind, ''))) <> 'quiz' or e.passed is true)
      and not exists (select 1 from "Learner".learner_progress_ksb_exclusions x
                       where x.progress_id = k.progress_id and x.position = k.position
                         and x.ksb_code = upper(btrim(k.ksb_code)) and x.status <> 'released')
  ), live as (
    select learner_id, array_agg(distinct code order by code) as codes from achieved group by learner_id
  )
  select count(*) into v_n
  from ksb_remap.learner_effect le
  left join live l on l.learner_id = le.learner_id
  where coalesce(l.codes, '{}') is distinct from coalesce(le.after_codes, '{}');
  if v_n > 0 then raise exception 'post-check: % learners differ from the planned achievement', v_n; end if;
  if v_fail = 'before_commit' then raise exception 'test hook: fail before commit'; end if;

  raise notice 'ksb description remap applied: %', v_counts;
end
$remap$;

commit;
