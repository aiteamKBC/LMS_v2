-- Retire the manual KSB profiles: the four apprenticeship programmes read the
-- government standards (curriculum.standard_ksbs) only.
--
-- Run this ONE file, once, after the KSB standards migration
-- (2026-10-14_ksb_standards_migration) is applied. Undo: rollback/undo_archive.sql.
--
-- What it does, in one transaction:
--   1. Records on each Skills Radar the profile it was answered against, where
--      that was never stored (Standard_id empty) and every answer id names one
--      existing profile ('KSBP-...-<index>'). The review form then shows those
--      signed answers with their own titles, not the programme's new standard.
--      The answers themselves and Updated_at are not touched.
--   2. Archives every manual profile (is_active = false). Nothing is deleted:
--      a programme or Skills Radar that names a profile still reads it, but no
--      programme discovers one any more.
-- Every value it changes is kept in ksb_migration_archive.manual_profile_archive.
--
-- It refuses (and changes nothing) unless:
--   - Associate Project Manager L4, Marketing Executive L4, Marketing Manager L6
--     and Project Controls Professional L6 each apply a standard, and
--   - no learner of those programmes is pinned to a manual profile version.
-- Idempotent: a second run finds nothing left to change.

begin;
create schema if not exists ksb_migration_archive;
create table if not exists ksb_migration_archive.manual_profile_archive (
  id bigserial primary key,
  run_at timestamptz not null default now(),
  kind text not null check (kind in ('skills_radar', 'profile')),
  record_key text not null,
  before_value jsonb not null,
  after_value jsonb not null,
  rolled_back_at timestamptz
);

do $archive$
declare
  v_programmes text[] := array['PROG-20260907141619067932', 'PROG-ME-L4', 'PROG-MM-L6', 'PROG-PCP-L6'];
  v_bad text;
  v_radar bigint;
  v_profiles bigint;
begin
  -- 1. Every target programme applies a government standard.
  select string_agg(t.pid || ' (' || coalesce(p.ksb_profile_source_id, 'missing') || ')', ', ')
    into v_bad
    from unnest(v_programmes) as t(pid)
    left join curriculum.programmes p on p.programme_id = t.pid and p.deleted_at is null
   where coalesce(p.ksb_profile_source_id, '') not ilike 'standard:%';
  if v_bad is not null then
    raise exception 'refusing: programme not on a standard: %', v_bad;
  end if;

  -- 2. No learner of those programmes is pinned to a manual profile version.
  --    A learner's programme is the one most of their progress entries carry
  --    (the rule 01_plan.sql used).
  select string_agg(lp.learner_id::text || ' -> ' || v.source_profile_id, ', ')
    into v_bad
    from (select distinct on (learner_id) learner_id, programme_id
            from (select learner_id, programme_id, count(*) as n
                    from "Learner".learner_progress_entries
                   where coalesce(programme_id, '') <> '' and deleted_at is null
                   group by 1, 2) z
           order by learner_id, n desc, programme_id) lp
    join "Learner".learner_ksb_assignments a on a.learner_id = lp.learner_id
    join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
   where lp.programme_id = any (v_programmes)
     and v.source_profile_id not ilike 'standard:%';
  if v_bad is not null then
    raise exception 'refusing: learners still pinned to a manual profile: %', v_bad;
  end if;

  -- 3. Skills Radar: record the profile the answers were given against.
  with answered as (
    select r.id as radar_id,
           min(regexp_replace(a."Ksb_id", '-[0-9]+$', '')) as profile_id,
           count(distinct regexp_replace(a."Ksb_id", '-[0-9]+$', '')) as sources,
           max(substring(a."Ksb_id" from '-([0-9]+)$')::int) as max_index
      from enrolment."Wizard_Skills_Radar" r
      join enrolment."Wizard_Ksb_Assessments" a
        on a."Learner_id" = r."Learner_id" and a."Learner_kind" is not distinct from r."Learner_kind"
     where coalesce(r."Standard_id", '') = ''
     group by r.id
  ), target as (
    select an.radar_id, an.profile_id
      from answered an
      join curriculum.ksb_profiles kp on kp.id = an.profile_id
     where an.sources = 1
       and an.profile_id ilike 'KSBP-%'
       -- every answer index exists in the profile's item list
       and an.max_index < jsonb_array_length(coalesce(kp.ksb_items::jsonb, '[]'::jsonb))
  ), logged as (
    insert into ksb_migration_archive.manual_profile_archive (kind, record_key, before_value, after_value)
    select 'skills_radar', r.id::text,
           jsonb_build_object('Standard_id', r."Standard_id"),
           jsonb_build_object('Standard_id', t.profile_id)
      from target t join enrolment."Wizard_Skills_Radar" r on r.id = t.radar_id
    returning record_key, after_value
  )
  update enrolment."Wizard_Skills_Radar" r
     set "Standard_id" = l.after_value ->> 'Standard_id'
    from logged l
   where r.id::text = l.record_key;
  get diagnostics v_radar = row_count;

  -- 4. Archive every manual profile.
  with logged as (
    insert into ksb_migration_archive.manual_profile_archive (kind, record_key, before_value, after_value)
    select 'profile', kp.id::text,
           jsonb_build_object('is_active', kp.is_active),
           jsonb_build_object('is_active', false)
      from curriculum.ksb_profiles kp
     where kp.is_active is distinct from false
    returning record_key
  )
  update curriculum.ksb_profiles kp
     set is_active = false
    from logged l
   where kp.id::text = l.record_key;
  get diagnostics v_profiles = row_count;

  raise notice 'manual KSB profiles retired: % Skills Radar source(s) recorded, % profile(s) archived',
    v_radar, v_profiles;
end
$archive$;
commit;
