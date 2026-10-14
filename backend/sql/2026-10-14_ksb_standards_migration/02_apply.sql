-- KSB standards migration -- step 2: apply the plan.
--
-- PREREQUISITES (in this order):
--   1. A Neon branch/snapshot of the target database taken immediately before
--      (the whole-database restore point).
--   2. 01_plan.sql run against the SAME database within the same maintenance
--      window, and its report reviewed (counts must match the approved report).
--   3. The application changes that read standards and the exclusion registry
--      deployed (see READINESS_REPORT.md). Without them the exclusion registry
--      is ignored by the readers.
--
-- WHAT IT DOES (one transaction; any failed check rolls everything back):
--   * copies every value it will change into schema ksb_migration_archive;
--   * creates the learner KSB versions for the target standards (same content
--     and SHA-256 key the application itself would create);
--   * repoints manual mappings (table + component JSON) to the standard, by the
--     description match in ksb_mig.item_match -- never by code;
--   * soft-deletes the live group-heading mappings (rows stay in the table,
--     marked deleted_by = 'ksb-standards-migration:unresolved-group-heading')
--     and removes them from the component JSON (copy kept in the archive);
--   * repoints learner progress KSB rows, writing one learner_activity_revisions
--     row per changed activity (as the application's own sync does);
--   * registers unresolved learner rows in "Learner".learner_progress_ksb_exclusions
--     (rows themselves are not modified);
--   * repins learners to the new standard versions;
--   * moves the verified programme(s) and their modules to the standard;
--   * re-computes every reconciled learner x KSB from the live tables and
--     aborts if anything differs from ksb_mig.recon.
--
-- It does NOT archive or delete any KSB profile, touch the 56 mis-pinned
-- learners (04_pin_remediation_plan.sql), touch historical records
-- (reviews, submissions, revisions, signed assessments), or Teams.
--
-- Idempotent: every write is conditioned on the row still holding its old
-- value, archives use ON CONFLICT DO NOTHING, and a second run is a no-op.
--
-- Test hook: SET ksb_mig.fail_at = 'after_mappings' | 'after_progress' |
-- 'before_commit' makes the block raise at that point (transaction rollback test).

begin;

do $mig$
declare
  v_run constant text := 'ksb-standards-2026-10-14';
  v_fail text := coalesce(current_setting('ksb_mig.fail_at', true), '');
  v_n bigint;
  v_attempt integer;
  v_ref text;
  v_counts jsonb := '{}'::jsonb;
  r record;
begin
  -- ------------------------------------------------------------------ checks
  if to_regclass('ksb_mig.mapping_plan') is null or to_regclass('ksb_mig.legacy_rows') is null then
    raise exception 'ksb_mig plan tables are missing: run 01_plan.sql first';
  end if;
  if exists (select 1 from ksb_mig.recon where verdict = 'DIFFERENT') then
    raise exception 'ksb_mig.recon has DIFFERENT rows: achievement would change';
  end if;
  if exists (select 1 from ksb_mig.merge_check) then
    raise exception 'ksb_mig.merge_check is not empty: code collisions';
  end if;
  if exists (select 1 from ksb_mig.mapping_plan where action = 'repoint' and conflict is not null) then
    raise exception 'mapping_plan has repoints that would collide with the unique index';
  end if;
  if exists (select 1 from ksb_mig.mapping_plan p join ksb_mig.item_match i
               on i.profile_id = p.profile_id and i.manual_code = upper(btrim(p.old_code))
             where p.action = 'repoint' and i.status <> 'matched') then
    raise exception 'a repoint uses a non-matched item (ambiguous / needs review)';
  end if;

  -- Plan freshness: rows that are neither in their old state nor already
  -- migrated mean the data moved since 01_plan.sql. Re-run the plan.
  select count(*) into v_n from ksb_mig.mapping_plan p join curriculum.ksb_mappings m on m.id = p.mapping_id
   where p.action = 'repoint'
     and not (m.ksb_code = p.old_code and m.source_id is not distinct from p.old_source_id)
     and not (upper(m.ksb_code) = p.std_code and m.source_type = 'standard' and m.source_id = p.std_sid);
  if v_n > 0 then raise exception 'stale plan: % mapping rows changed since 01_plan.sql', v_n; end if;

  select count(*) into v_n from ksb_mig.progress_plan p
    join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action = 'repoint'
     and not (upper(btrim(k.ksb_code)) = p.old_code and k.source_id is not distinct from p.old_source_id)
     and not (upper(btrim(k.ksb_code)) = p.std_code and k.source_type = 'standard' and k.source_id = p.std_sid);
  if v_n > 0 then raise exception 'stale plan: % learner KSB rows changed since 01_plan.sql', v_n; end if;

  select count(*) into v_n from ksb_mig.progress_plan p
   where p.action = 'repoint'
     and not exists (select 1 from "Learner".learner_progress_ksbs k where k.progress_id = p.progress_id and k.position = p.position);
  if v_n > 0 then raise exception 'stale plan: % planned learner KSB rows no longer exist', v_n; end if;

  -- New manual rows written after the plan was built would be left behind.
  select count(*) into v_n from curriculum.ksb_mappings m
    join curriculum.modules mo on mo.module_catalogue_id = m.module_catalogue_id
    join ksb_mig.programme_scope s on s.programme_id = mo.programme_id and s.decision = 'migrate'
   where m.source_id ilike '%KSBP-%' and coalesce(m.is_programme_deleted, false) = false
     and not exists (select 1 from ksb_mig.mapping_plan p where p.mapping_id = m.id);
  if v_n > 0 then raise exception 'stale plan: % new manual mappings since 01_plan.sql', v_n; end if;

  select count(*) into v_n from "Learner".learner_progress_ksbs k
   where k.source_id ilike '%KSBP-%'
     and not exists (select 1 from ksb_mig.progress_plan p where p.progress_id = k.progress_id and p.position = k.position);
  if v_n > 0 then raise exception 'stale plan: % new manual learner KSB rows since 01_plan.sql', v_n; end if;

  -- ----------------------------------------------------------------- archive
  create schema if not exists ksb_migration_archive;
  create table if not exists ksb_migration_archive.run_log (
    run_id text primary key, applied_at timestamptz, rolled_back_at timestamptz,
    status text not null, attempt integer not null default 1, counts jsonb not null default '{}'::jsonb);
  create table if not exists ksb_migration_archive.mappings_before (like curriculum.ksb_mappings including defaults);
  create table if not exists ksb_migration_archive.components_before (id text primary key, ksb_mappings jsonb);
  -- What the apply wrote: 03_rollback.sql restores a component only while it
  -- still holds exactly this value (a later edit is reported, never clobbered).
  create table if not exists ksb_migration_archive.components_after (id text primary key, ksb_mappings jsonb);
  create table if not exists ksb_migration_archive.progress_ksbs_before (like "Learner".learner_progress_ksbs including defaults);
  create table if not exists ksb_migration_archive.pins_before (learner_id bigint primary key, profile_version_id bigint not null, updated_at timestamptz);
  create table if not exists ksb_migration_archive.programmes_before (programme_id text primary key, ksb_profile_source_id text, updated_at timestamptz);
  create table if not exists ksb_migration_archive.modules_before (module_catalogue_id text primary key, ksb_profile_source_id text, updated_at timestamptz);
  create table if not exists ksb_migration_archive.versions_created (profile_version_id bigint primary key, source_profile_id text, run_id text);
  if not exists (select 1 from pg_constraint where conname = 'ksb_mig_archive_mappings_pk') then
    alter table ksb_migration_archive.mappings_before add constraint ksb_mig_archive_mappings_pk primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ksb_mig_archive_progress_pk') then
    alter table ksb_migration_archive.progress_ksbs_before add constraint ksb_mig_archive_progress_pk primary key (progress_id, position);
  end if;

  -- A re-application after a rollback is a new attempt: its revisions get
  -- their own source_ref. The *_before archives keep the original values.
  insert into ksb_migration_archive.run_log (run_id, status) values (v_run, 'applying')
  on conflict (run_id) do update
     set status = 'applying', attempt = ksb_migration_archive.run_log.attempt + 1, counts = '{}'::jsonb
   where ksb_migration_archive.run_log.status = 'rolled_back';
  select attempt into v_attempt from ksb_migration_archive.run_log where run_id = v_run;
  v_ref := v_run || ':a' || v_attempt;

  -- A new attempt after a rollback archives the values as they are NOW. The
  -- previous attempt's archive is set aside as <table>_a<n> (kept, never
  -- deleted); otherwise ON CONFLICT DO NOTHING below would keep its older
  -- copies, and a later rollback would restore them over edits made since.
  if v_attempt > 1 and exists (select 1 from ksb_migration_archive.run_log where run_id = v_run and status = 'applying') then
    for r in
      select t.name from unnest(array['mappings_before', 'components_before', 'components_after', 'progress_ksbs_before',
                                      'pins_before', 'programmes_before', 'modules_before']) as t(name)
    loop
      execute format('create table ksb_migration_archive.%I as table ksb_migration_archive.%I', r.name || '_a' || (v_attempt - 1), r.name);
      execute format('truncate ksb_migration_archive.%I', r.name);
    end loop;
  end if;

  -- The plan this run applies, frozen in the archive: 03_rollback.sql reads
  -- these copies, so re-running 01_plan.sql afterwards cannot confuse it.
  -- Refreshed only when a new attempt starts (first apply, or after a rollback).
  if exists (select 1 from ksb_migration_archive.run_log where run_id = v_run and status = 'applying') then
    drop table if exists ksb_migration_archive.plan_mapping, ksb_migration_archive.plan_progress,
                         ksb_migration_archive.plan_pin, ksb_migration_archive.plan_programme;
  end if;
  create table if not exists ksb_migration_archive.plan_mapping as select * from ksb_mig.mapping_plan;
  create table if not exists ksb_migration_archive.plan_progress as select * from ksb_mig.progress_plan;
  create table if not exists ksb_migration_archive.plan_pin as select * from ksb_mig.pin_plan;
  create table if not exists ksb_migration_archive.plan_programme as select * from ksb_mig.programme_scope;

  insert into ksb_migration_archive.mappings_before
  select m.* from curriculum.ksb_mappings m
   where m.id in (select mapping_id from ksb_mig.mapping_plan where action in ('repoint', 'review_group_heading'))
     and m.source_id ilike '%KSBP-%'
  on conflict (id) do nothing;

  insert into ksb_migration_archive.components_before
  select c.id, c.ksb_mappings from curriculum.components c
   where c.id in (select component_id from ksb_mig.component_json_plan where action in ('repoint', 'review_group_heading'))
     and c.ksb_mappings::text ilike '%KSBP-%'
  on conflict (id) do nothing;

  insert into ksb_migration_archive.progress_ksbs_before
  select k.* from "Learner".learner_progress_ksbs k
    join ksb_mig.progress_plan p on p.progress_id = k.progress_id and p.position = k.position
   where p.action = 'repoint' and upper(btrim(k.ksb_code)) = p.old_code
  on conflict (progress_id, position) do nothing;

  insert into ksb_migration_archive.pins_before
  select a.learner_id, a.profile_version_id, a.updated_at from "Learner".learner_ksb_assignments a
    join ksb_mig.pin_plan p on p.learner_id = a.learner_id and p.action = 'repin' and a.profile_version_id = p.old_version_id
  on conflict (learner_id) do nothing;

  insert into ksb_migration_archive.programmes_before
  select p.programme_id, p.ksb_profile_source_id, p.updated_at from curriculum.programmes p
    join ksb_mig.programme_scope s on s.programme_id = p.programme_id and s.decision = 'migrate'
   where p.ksb_profile_source_id = s.current_source
  on conflict (programme_id) do nothing;

  insert into ksb_migration_archive.modules_before
  select mo.module_catalogue_id, mo.ksb_profile_source_id, mo.updated_at from curriculum.modules mo
    join ksb_mig.programme_scope s on s.programme_id = mo.programme_id and s.decision = 'migrate'
   where mo.ksb_profile_source_id is distinct from 'standard:' || s.std_sid
  on conflict (module_catalogue_id) do nothing;

  -- ------------------------------------------------- exclusion registry (DDL)
  create table if not exists "Learner".learner_progress_ksb_exclusions (
    progress_id bigint not null,
    position integer not null,
    ksb_code varchar(64) not null,
    source_id text,
    status text not null check (status in (
      'excluded_group_heading', 'excluded_other_standard', 'excluded_unresolved',
      'excluded_orphan', 'pending_verification', 'released')),
    reason text not null,
    run_id text not null,
    created_at timestamptz not null default now(),
    primary key (progress_id, position));
  comment on table "Learner".learner_progress_ksb_exclusions is
    'Learner KSB rows kept unchanged but NOT counted as achievement of the programme''s standard. '
    'A row is skipped only while its ksb_code still equals the registered code and its status is not released. '
    'Reviewed rows are released (status = released), never deleted, so the decision stays on record.';

  -- --------------------------------------------- learner versions (standards)
  -- The version a standard's learners are pinned to: created here, or the
  -- identical one (same source + SHA-256 key) if it already exists.
  create temp table if not exists ksb_mig_target_versions (std_sid text primary key, version_id bigint not null) on commit drop;
  for r in
    select distinct p.std_sid from ksb_mig.pin_plan p where p.action = 'repin'
  loop
    with canon as (
      select s.std_row_id, s.std_code as code, substr(s.std_code, 2) as number,
             case left(s.std_code, 1) when 'K' then 'Knowledge' when 'S' then 'Skills' else 'Behaviours' end as ktype,
             btrim(sk.ksb_description) as description
      from ksb_mig.std s join curriculum.standard_ksbs sk on sk.id = s.std_row_id
      where s.sid = r.std_sid
    ), h as (
      select encode(sha256(convert_to('[' || string_agg(
               '{"code":' || to_json(code)::text || ',"description":' || to_json(description)::text ||
               ',"number":' || to_json(number)::text || ',"type":' || to_json(ktype)::text || '}', ','
               order by std_row_id) || ']', 'UTF8')), 'hex') as version_hash,
             count(*) as n
      from canon
    ), ins as (
      insert into curriculum.ksb_profile_versions (source_profile_id, version_hash, programme, definition_count, created_at)
      select 'standard:' || r.std_sid, h.version_hash,
             coalesce((select min(p.name) from curriculum.programmes p
                        where p.programme_id in (select programme_id from ksb_mig.programme_scope where decision = 'migrate' and std_sid = r.std_sid)
                           or (p.ksb_profile_source_id = 'standard:' || r.std_sid and coalesce(p.status, '') <> 'archived')), ''),
             h.n, now()
      from h
      on conflict (source_profile_id, version_hash) do nothing
      returning id
    )
    insert into ksb_migration_archive.versions_created (profile_version_id, source_profile_id, run_id)
    select id, 'standard:' || r.std_sid, v_run from ins;

    insert into ksb_mig_target_versions (std_sid, version_id)
    select r.std_sid, v.id from curriculum.ksb_profile_versions v
     where v.source_profile_id = 'standard:' || r.std_sid
       and v.version_hash = (
         select encode(sha256(convert_to('[' || string_agg(
                  '{"code":' || to_json(s.std_code)::text || ',"description":' || to_json(btrim(sk.ksb_description))::text ||
                  ',"number":' || to_json(substr(s.std_code, 2))::text || ',"type":' ||
                  to_json(case left(s.std_code, 1) when 'K' then 'Knowledge' when 'S' then 'Skills' else 'Behaviours' end)::text || '}', ','
                  order by s.std_row_id) || ']', 'UTF8')), 'hex')
         from ksb_mig.std s join curriculum.standard_ksbs sk on sk.id = s.std_row_id where s.sid = r.std_sid)
    on conflict (std_sid) do update set version_id = excluded.version_id;
    if not exists (select 1 from ksb_mig_target_versions where std_sid = r.std_sid) then
      raise exception 'no learner KSB version resolved for standard %', r.std_sid;
    end if;

    insert into curriculum.ksb_definitions (profile_version_id, position, code, number, ksb_type, description)
    select v.id, row_number() over (order by s.std_row_id), s.std_code, substr(s.std_code, 2),
           case left(s.std_code, 1) when 'K' then 'Knowledge' when 'S' then 'Skills' else 'Behaviours' end,
           btrim(sk.ksb_description)
    from ksb_mig_target_versions tv
    join curriculum.ksb_profile_versions v on v.id = tv.version_id
    join ksb_mig.std s on s.sid = r.std_sid
    join curriculum.standard_ksbs sk on sk.id = s.std_row_id
    where tv.std_sid = r.std_sid
    on conflict (profile_version_id, code) do nothing;
  end loop;

  -- --------------------------------------------------------- mappings (table)
  update curriculum.ksb_mappings m
     set ksb_code = p.std_code,
         ksb_id = p.std_sid || '-' || s.std_row_id,
         ksb_description = p.std_desc,
         source_type = 'standard',
         source_id = p.std_sid,
         updated_at = now()
    from ksb_mig.mapping_plan p
    join ksb_mig.std s on s.sid = p.std_sid and s.std_code = p.std_code
   where m.id = p.mapping_id and p.action = 'repoint'
     and m.ksb_code = p.old_code and m.source_id is not distinct from p.old_source_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mappings_repointed', v_n);

  update curriculum.ksb_mappings m
     set is_programme_deleted = true,
         deleted_at = now(),
         deleted_by = 'ksb-standards-migration:unresolved-group-heading',
         updated_at = now()
    from ksb_mig.mapping_plan p
   where m.id = p.mapping_id and p.action = 'review_group_heading'
     and coalesce(m.is_programme_deleted, false) = false;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('heading_mappings_soft_deleted', v_n);

  -- ---------------------------------------------------- mappings (component JSON)
  with targets as (
    select distinct component_id from ksb_mig.component_json_plan where action in ('repoint', 'review_group_heading')
  ), rebuilt as (
    select c.id,
           coalesce(jsonb_agg(
             case when p.action = 'repoint'
                       and upper(btrim(coalesce(x.e->>'ksb_code', x.e->>'code'))) = p.old_code
                  then x.e || jsonb_build_object(
                         'ksb_code', p.std_code,
                         'ksb_id', p.std_sid || '-' || s.std_row_id,
                         'description', p.std_desc,
                         'source_type', 'standard',
                         'source_id', p.std_sid)
                       || case when x.e ? 'code' then jsonb_build_object('code', p.std_code) else '{}'::jsonb end
                  else x.e end
             order by x.ord) filter (where not (coalesce(p.action, '') = 'review_group_heading' and not coalesce(p.row_deleted, false))), '[]'::jsonb) as items
    from curriculum.components c
    join targets t on t.component_id = c.id
    cross join lateral jsonb_array_elements(c.ksb_mappings) with ordinality as x(e, ord)
    left join ksb_mig.component_json_plan p on p.component_id = c.id and p.item_id = x.e->>'id'
    left join ksb_mig.std s on s.sid = p.std_sid and s.std_code = p.std_code
    where jsonb_typeof(c.ksb_mappings) = 'array'
    group by c.id
  )
  update curriculum.components c set ksb_mappings = r2.items
    from rebuilt r2
   where c.id = r2.id and c.ksb_mappings is distinct from r2.items;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('components_rewritten', v_n);

  insert into ksb_migration_archive.components_after (id, ksb_mappings)
  select c.id, c.ksb_mappings from curriculum.components c
   where c.id in (select id from ksb_migration_archive.components_before)
  on conflict (id) do update set ksb_mappings = excluded.ksb_mappings;

  if v_fail = 'after_mappings' then raise exception 'test hook: fail after mappings'; end if;

  -- ---------------------------------------------------- learner progress KSBs
  -- One revision per activity whose KSB snapshot changes, like curriculum sync.
  with touched as (
    select distinct p.progress_id from ksb_mig.progress_plan p
      join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
     where p.action = 'repoint' and upper(btrim(k.ksb_code)) = p.old_code
       and k.source_id is not distinct from p.old_source_id
  ), snap as (
    select k.progress_id,
           jsonb_agg(jsonb_build_object(
             'position', k.position, 'ksb_code', k.ksb_code, 'ksb_description', k.ksb_description,
             'source_type', k.source_type, 'source_id', k.source_id, 'classification', k.classification,
             'weight', k.weight::float, 'weight_class', k.weight_class) order by k.position) as before_s,
           jsonb_agg(jsonb_build_object(
             'position', k.position,
             'ksb_code', case when p.action = 'repoint' then p.std_code else k.ksb_code end,
             'ksb_description', case when p.action = 'repoint' then p.std_desc else k.ksb_description end,
             'source_type', case when p.action = 'repoint' then 'standard' else k.source_type end,
             'source_id', case when p.action = 'repoint' then p.std_sid else k.source_id end,
             'classification', k.classification, 'weight', k.weight::float, 'weight_class', k.weight_class)
             order by k.position) as after_s
    from "Learner".learner_progress_ksbs k
    join touched t on t.progress_id = k.progress_id
    left join ksb_mig.progress_plan p on p.progress_id = k.progress_id and p.position = k.position
    group by k.progress_id
  )
  insert into "Learner".learner_activity_revisions
    (learner_id, progress_id, report_month, source_system, source_ref, change_kind, before_snapshot, after_snapshot, actor)
  select e.learner_id, e.id, e.reporting_month, 'ksb-standards-migration',
         v_ref || ':progress:' || e.id, 'ksb_standard_migration',
         jsonb_build_object('ksbs', sn.before_s), jsonb_build_object('ksbs', sn.after_s), 'ksb-standards-migration'
  from snap sn join "Learner".learner_progress_entries e on e.id = sn.progress_id
  on conflict (source_system, source_ref, change_kind) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_revisions_written', v_n);

  update "Learner".learner_progress_ksbs k
     set ksb_code = p.std_code,
         ksb_description = p.std_desc,
         source_type = 'standard',
         source_id = p.std_sid,
         ksb_definition_id = case when k.ksb_definition_id is null then null else (
           select d.id from curriculum.ksb_definitions d
             join ksb_mig_target_versions tv on tv.version_id = d.profile_version_id
            where tv.std_sid = p.std_sid and d.code = p.std_code) end
    from ksb_mig.progress_plan p
   where k.progress_id = p.progress_id and k.position = p.position and p.action = 'repoint'
     and upper(btrim(k.ksb_code)) = p.old_code and k.source_id is not distinct from p.old_source_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learner_ksb_rows_repointed', v_n);

  -- Unresolved rows: registered, never modified.
  insert into "Learner".learner_progress_ksb_exclusions (progress_id, position, ksb_code, source_id, status, reason, run_id)
  select p.progress_id, p.position, p.old_code, p.old_source_id,
         case p.action when 'review_group_heading' then 'excluded_group_heading'
                       when 'review_no_profile' then 'excluded_orphan'
                       else 'excluded_unresolved' end,
         case p.action when 'review_group_heading' then 'Manual group heading ' || p.old_code || ' has no standard equivalent'
                       when 'review_no_profile' then 'Source-less dotted code; learner has no programme or profile'
                       else 'Manual code without a verified standard match' end,
         v_run
  from ksb_mig.progress_plan p
  where p.action in ('review_group_heading', 'review_unresolved', 'review_no_profile')
  on conflict (progress_id, position) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('exclusions_from_plan', v_n);

  insert into "Learner".learner_progress_ksb_exclusions (progress_id, position, ksb_code, source_id, status, reason, run_id)
  select l.progress_id, l.position, l.ksb_code, l.source_id, l.status,
         case l.status when 'excluded_group_heading' then 'Imported row carrying a manual group heading; not a standard KSB'
                       when 'excluded_other_standard' then 'Row belongs to another standard (' || coalesce(l.source_id, '') || ')'
                       when 'pending_verification' then 'Code in the standard''s numbering, origin not verified'
                       else 'Description does not identify a standard KSB' end,
         v_run
  from ksb_mig.legacy_rows l
  where l.status in ('excluded_group_heading', 'excluded_other_standard', 'excluded_unresolved', 'pending_verification')
  on conflict (progress_id, position) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('exclusions_legacy', v_n);

  if v_fail = 'after_progress' then raise exception 'test hook: fail after progress'; end if;

  -- -------------------------------------------------------------------- pins
  update "Learner".learner_ksb_assignments a
     set profile_version_id = v.version_id, updated_at = now()
    from ksb_mig.pin_plan p
    join ksb_mig_target_versions v on v.std_sid = p.std_sid
   where a.learner_id = p.learner_id and p.action = 'repin' and a.profile_version_id = p.old_version_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learners_repinned', v_n);

  -- ------------------------------------------------- programme + its modules
  update curriculum.programmes p
     set ksb_profile_source_id = 'standard:' || s.std_sid, updated_at = now()
    from ksb_mig.programme_scope s
   where s.programme_id = p.programme_id and s.decision = 'migrate'
     and p.ksb_profile_source_id = s.current_source;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('programmes_moved', v_n);

  update curriculum.modules mo
     set ksb_profile_source_id = 'standard:' || s.std_sid, updated_at = now()
    from ksb_mig.programme_scope s
   where s.programme_id = mo.programme_id and s.decision = 'migrate'
     and mo.ksb_profile_source_id is distinct from 'standard:' || s.std_sid;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modules_moved', v_n);

  -- ------------------------------------------------------------ post-checks
  select count(*) into v_n from curriculum.ksb_mappings m
    join curriculum.modules mo on mo.module_catalogue_id = m.module_catalogue_id
    join ksb_mig.programme_scope s on s.programme_id = mo.programme_id and s.decision = 'migrate'
   where m.source_id ilike '%KSBP-%' and coalesce(m.is_programme_deleted, false) = false;
  if v_n > 0 then raise exception 'post-check: % live manual mappings remain in a migrated programme', v_n; end if;

  select count(*) into v_n from curriculum.components c
    join curriculum.modules mo on mo.module_catalogue_id = c.module_catalogue_id
    join ksb_mig.programme_scope s on s.programme_id = mo.programme_id and s.decision = 'migrate'
   where coalesce(c.is_programme_deleted, false) = false and c.ksb_mappings::text ilike '%KSBP-%';
  if v_n > 0 then raise exception 'post-check: % live components still carry manual JSON items', v_n; end if;

  select count(*) into v_n from ksb_mig.progress_plan p
    join "Learner".learner_progress_ksbs k on k.progress_id = p.progress_id and k.position = p.position
   where p.action = 'repoint' and not (k.ksb_code = p.std_code and k.source_type = 'standard' and k.source_id = p.std_sid);
  if v_n > 0 then raise exception 'post-check: % planned learner rows were not repointed', v_n; end if;

  -- Every reconciled learner x standard KSB, recomputed from the live tables
  -- with the registry applied, must equal the plan's AFTER side exactly.
  with learners as (
    select distinct learner_id from ksb_mig.recon
  ), live_rows as (
    select k.progress_id, e.learner_id, e.kind, e.passed, e.component_ref,
           upper(btrim(k.ksb_code)) as code, coalesce(k.weight, 0) as weight
    from "Learner".learner_progress_ksbs k
    join "Learner".learner_progress_entries e on e.id = k.progress_id
    where e.learner_id in (select learner_id from learners)
      and not exists (select 1 from "Learner".learner_progress_ksb_exclusions x
                      where x.progress_id = k.progress_id and x.position = k.position and x.ksb_code = upper(btrim(k.ksb_code)))
  ), live as (
    select learner_id, code as std_code, sum(w) as weight, string_agg(comp, ',' order by comp) as components
    from (
      select distinct on (learner_id, coalesce(component_ref, progress_id::text), code)
             learner_id, code, coalesce(component_ref, 'p' || progress_id) as comp, w
      from (select learner_id, progress_id, component_ref, code, max(weight) as w,
                   bool_or(passed is not false and (lower(coalesce(kind, '')) <> 'quiz' or passed is true)) as ok
            from live_rows group by learner_id, progress_id, component_ref, code) z
      where ok order by learner_id, coalesce(component_ref, progress_id::text), code, progress_id desc
    ) d group by learner_id, code
  )
  select count(*) into v_n
  from (select * from ksb_mig.recon where after_weight is not null) rc
  full join live l on l.learner_id = rc.learner_id and l.std_code = rc.std_code
  where rc.after_weight is distinct from l.weight or rc.after_components is distinct from l.components;
  if v_n > 0 then raise exception 'post-check: % learner x KSB results differ from the reconciliation', v_n; end if;

  if v_fail = 'before_commit' then raise exception 'test hook: fail before commit'; end if;

  update ksb_migration_archive.run_log
     set counts = case when status = 'applied'
                       then counts || jsonb_build_object('last_rerun_at', now(), 'last_rerun_counts', v_counts)
                       else v_counts end,
         applied_at = case when status = 'applying' then now() else applied_at end,
         status = 'applied'
   where run_id = v_run;
  raise notice 'ksb standards migration applied: %', v_counts;
end
$mig$;

commit;
