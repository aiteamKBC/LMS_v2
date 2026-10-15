-- Separate remediation: learners whose KSB pin carries the wrong label.
--
-- NOT part of the KSB standards migration transaction. Run only after
-- 02_apply.sql has been applied (it needs the standard:st0596-v1-0 version),
-- in the same maintenance window, as its own transaction.
--
-- ROOT CAUSE (see READINESS_REPORT.md, section 6)
--   learner_api.active_users.refresh_learner_ksb_snapshot() resolves the KSB
--   *items* (_fetch_ksb_items) and the version *label*
--   (_resolve_ksb_profile_source_id) independently. When the label resolved
--   to standard:st0845-v1-1 but the standard lookup returned nothing, the
--   items fell back to the profile found by programme name -- the Marketing
--   executive manual profile (47 items). Result: version 14, labelled
--   'standard:st0845-v1-1', holding the ME manual items; 56 Marketing
--   Executive Level 4 learners pinned to it between 2026-08-25 and 2026-09-17.
--   The test versions labelled st0845 with 2-11 items show the same pattern.
--
-- PART A runs by default and is READ-ONLY: it lists who is affected.
-- PART B changes data and runs only when explicitly confirmed:
--   SET ksb_pin_fix.confirm = 'yes';

-- ------------------------------------------------------- PART A (read-only)
select a.learner_id, v.id as version_id, v.source_profile_id as pinned_label, v.definition_count,
       (select string_agg(d.code, ',' order by d.position) from (
          select code, position from curriculum.ksb_definitions where profile_version_id = v.id order by position limit 6) d) as first_codes,
       lp.programme_id as learner_programme,
       p.ksb_profile_source_id as programme_source_now,
       a.assigned_at
from "Learner".learner_ksb_assignments a
join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
left join lateral (
  select programme_id from "Learner".learner_progress_entries e
  where e.learner_id = a.learner_id and coalesce(e.programme_id, '') <> '' and e.deleted_at is null
  group by programme_id order by count(*) desc, programme_id limit 1) lp on true
left join curriculum.programmes p on p.programme_id = lp.programme_id
where v.source_profile_id like 'standard:%'
  and p.ksb_profile_source_id like 'standard:%'
  and p.ksb_profile_source_id <> v.source_profile_id
order by a.learner_id;

-- ------------------------------------------- PART B (confirmed correction)
-- Repins each listed learner to the version of the standard their programme
-- now uses, only when:
--   * the programme's standard version exists (created by 02_apply.sql);
--   * the learner's current version is still the mislabelled one;
--   * the version they are moved from holds the programme's former manual
--     profile content (definition_count matches), i.e. a label-only defect.
-- Old version ids are archived for rollback; no other row is touched.
begin;
do $fix$
declare
  v_n bigint;
begin
  if coalesce(current_setting('ksb_pin_fix.confirm', true), '') <> 'yes' then
    raise notice 'PART B skipped: set ksb_pin_fix.confirm = yes to apply';
    return;
  end if;
  create schema if not exists ksb_migration_archive;
  create table if not exists ksb_migration_archive.pin_fix_before (
    learner_id bigint primary key, profile_version_id bigint not null, updated_at timestamptz, fixed_at timestamptz default now());

  with target as (
    select a.learner_id, a.profile_version_id as old_version_id, a.updated_at,
           (select tv.id from curriculum.ksb_profile_versions tv
             where tv.source_profile_id = p.ksb_profile_source_id
             order by tv.id desc limit 1) as new_version_id
    from "Learner".learner_ksb_assignments a
    join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
    join lateral (
      select programme_id from "Learner".learner_progress_entries e
      where e.learner_id = a.learner_id and coalesce(e.programme_id, '') <> '' and e.deleted_at is null
      group by programme_id order by count(*) desc, programme_id limit 1) lp on true
    join curriculum.programmes p on p.programme_id = lp.programme_id
    where v.source_profile_id = 'standard:st0845-v1-1' and v.definition_count = 47
      and p.programme_id = 'PROG-ME-L4' and p.ksb_profile_source_id = 'standard:st0596-v1-0'
  ), archived as (
    insert into ksb_migration_archive.pin_fix_before (learner_id, profile_version_id, updated_at)
    select learner_id, old_version_id, updated_at from target where new_version_id is not null
    on conflict (learner_id) do nothing
    returning learner_id
  )
  update "Learner".learner_ksb_assignments a
     set profile_version_id = t.new_version_id, updated_at = now()
    from target t
   where a.learner_id = t.learner_id and t.new_version_id is not null
     and a.profile_version_id = t.old_version_id;
  get diagnostics v_n = row_count;
  raise notice 'pin remediation: % learners repinned to standard:st0596-v1-0', v_n;
end
$fix$;
commit;

-- Rollback of PART B: use 04b_pin_remediation_rollback.sql, which restores a pin
-- only while it still holds the version PART B set. The unconditional form
-- below is kept for reference only; it would overwrite later pin changes:
--   update "Learner".learner_ksb_assignments a
--      set profile_version_id = b.profile_version_id, updated_at = b.updated_at
--     from ksb_migration_archive.pin_fix_before b where a.learner_id = b.learner_id;
