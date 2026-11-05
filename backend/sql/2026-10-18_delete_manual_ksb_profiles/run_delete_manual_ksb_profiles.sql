-- Delete the manual KSB profiles that nothing reads any more. KSBs come from the
-- government standards (curriculum.standard_ksbs) only.
--
-- Run this ONE file, once, after 2026-10-15_archive_manual_ksb_profiles has run.
-- Undo: rollback/restore_deleted_profiles.sql.
--
-- What it does, in one transaction:
--   1. Copies each unreferenced manual profile, the whole row, into
--      ksb_migration_archive.manual_profile_deletions.
--   2. Deletes those rows from curriculum.ksb_profiles.
--
-- A profile is KEPT while any of these still names it (by id or ksb_profile_id,
-- with or without a profile:/framework: prefix):
--   programmes, modules, ksb_mappings, components.ksb_mappings items,
--   ksb_profile_versions (learner pins), "Learner".learner_progress_ksbs,
--   enrolment."Wizard_Skills_Radar" (signed answers keep their titles) and
--   enrolment."Wizard_Ksb_Assessments" answer ids ('<profile>-<index>').
--
-- It refuses (and changes nothing) while any manual profile is still active:
-- the 15 Oct archive must have run first.
-- Idempotent: a second run finds nothing left to delete.

begin;
create schema if not exists ksb_migration_archive;
create table if not exists ksb_migration_archive.manual_profile_deletions (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  profile_id text not null,
  profile_row jsonb not null,
  restored_at timestamptz
);

do $delete$
declare
  v_active text;
  v_deleted bigint;
  v_kept bigint;
begin
  select string_agg(id::text || ' (' || coalesce(name, '') || ')', ', ')
    into v_active
    from curriculum.ksb_profiles
   where is_active is distinct from false;
  if v_active is not null then
    raise exception 'refusing: manual profile still active, run 2026-10-15_archive_manual_ksb_profiles first: %', v_active;
  end if;

  create temporary table manual_profile_refs on commit drop as
  select regexp_replace(lower(btrim(ksb_profile_source_id)), '^(profile|framework):', '') as ref
    from curriculum.programmes where coalesce(ksb_profile_source_id, '') <> ''
  union
  select regexp_replace(lower(btrim(ksb_profile_source_id)), '^(profile|framework):', '')
    from curriculum.modules where coalesce(ksb_profile_source_id, '') <> ''
  union
  select regexp_replace(lower(btrim(source_id)), '^(profile|framework):', '')
    from curriculum.ksb_mappings where coalesce(source_id, '') <> ''
  union
  select regexp_replace(lower(btrim(coalesce(x.e ->> 'source_id', x.e ->> 'sourceId'))), '^(profile|framework):', '')
    from curriculum.components c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.ksb_mappings) = 'array' then c.ksb_mappings else '[]'::jsonb end) as x(e)
   where coalesce(x.e ->> 'source_id', x.e ->> 'sourceId', '') <> ''
  union
  select regexp_replace(lower(btrim(source_profile_id)), '^(profile|framework):', '')
    from curriculum.ksb_profile_versions where coalesce(source_profile_id, '') <> ''
  union
  select regexp_replace(lower(btrim(source_id)), '^(profile|framework):', '')
    from "Learner".learner_progress_ksbs where coalesce(source_id, '') <> ''
  union
  select regexp_replace(lower(btrim("Standard_id")), '^(profile|framework):', '')
    from enrolment."Wizard_Skills_Radar" where coalesce("Standard_id", '') <> ''
  union
  select lower(regexp_replace(btrim("Ksb_id"), '-[0-9]+$', ''))
    from enrolment."Wizard_Ksb_Assessments" where coalesce("Ksb_id", '') <> '';

  with doomed as (
    select kp.*
      from curriculum.ksb_profiles kp
     where not exists (
       select 1 from manual_profile_refs r
        where r.ref in (lower(kp.id::text), lower(coalesce(kp.ksb_profile_id, '')))
     )
  ), logged as (
    insert into ksb_migration_archive.manual_profile_deletions (profile_id, profile_row)
    select d.id::text, to_jsonb(d) from doomed d
    returning profile_id
  )
  delete from curriculum.ksb_profiles kp
   using logged l
   where kp.id::text = l.profile_id;
  get diagnostics v_deleted = row_count;

  select count(*) into v_kept from curriculum.ksb_profiles;

  raise notice 'manual KSB profiles: % deleted, % kept because a record still names them',
    v_deleted, v_kept;
end
$delete$;
commit;
