-- Rollback of 04_pin_remediation_plan.sql PART B (only if needed).
--
-- Replaces the unconditional rollback that 04 shows as a comment: a pin is
-- restored only while it still holds the standard version PART B gave it
-- (standard:st0596-v1-0). A pin the application has moved since is a CONFLICT
-- and is left as it is (counted in a notice). Restored rows move from
-- ksb_migration_archive.pin_fix_before to pin_fix_rolled_back (kept, never
-- deleted), so a later PART B re-archives the values as they are then.
--
-- Order when undoing everything: 07b_orphan_recovery_rollback.sql, this file,
-- then 03_rollback.sql. Runs only when explicitly confirmed:
--   SET ksb_pin_fix.rollback = 'yes';
-- Idempotent: a second run finds nothing left to restore.

begin;
do $pin_rb$
declare
  v_n bigint;
begin
  if coalesce(current_setting('ksb_pin_fix.rollback', true), '') <> 'yes' then
    raise notice 'skipped: set ksb_pin_fix.rollback = yes to roll back the pin remediation';
    return;
  end if;
  if to_regclass('ksb_migration_archive.pin_fix_before') is null then
    raise notice 'nothing to roll back: 04 PART B never ran';
    return;
  end if;
  -- The orphan recovery relies on these pins: undo it first.
  -- Nested: PL/pgSQL parses the whole condition, so the table must exist
  -- before the query that reads it is even prepared (07 may never have run).
  if to_regclass('ksb_migration_archive.orphan_fix_before') is not null then
    if exists (select 1 from ksb_migration_archive.orphan_fix_before where rolled_back_at is null) then
      raise exception 'roll back 07_orphan_recovery.sql first (07b_orphan_recovery_rollback.sql)';
    end if;
  end if;

  create table if not exists ksb_migration_archive.pin_fix_rolled_back (
    learner_id bigint not null, profile_version_id bigint not null, updated_at timestamptz,
    fixed_at timestamptz, rolled_back_at timestamptz not null default now());

  create temp table ksb_pin_restore on commit drop as
  select b.* from ksb_migration_archive.pin_fix_before b
  join "Learner".learner_ksb_assignments a on a.learner_id = b.learner_id
  join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
  where v.source_profile_id = 'standard:st0596-v1-0' and a.profile_version_id <> b.profile_version_id;

  select count(*) into v_n from ksb_migration_archive.pin_fix_before b
   where not exists (select 1 from ksb_pin_restore r where r.learner_id = b.learner_id);
  if v_n > 0 then
    raise notice '% pins changed since the remediation: left as they are (conflicts)', v_n;
  end if;

  update "Learner".learner_ksb_assignments a
     set profile_version_id = r.profile_version_id, updated_at = r.updated_at
    from ksb_pin_restore r
   where a.learner_id = r.learner_id;
  get diagnostics v_n = row_count;

  insert into ksb_migration_archive.pin_fix_rolled_back (learner_id, profile_version_id, updated_at, fixed_at)
  select learner_id, profile_version_id, updated_at, fixed_at from ksb_pin_restore;
  delete from ksb_migration_archive.pin_fix_before b using ksb_pin_restore r where b.learner_id = r.learner_id;

  raise notice 'pin remediation rolled back: % learners restored', v_n;
end
$pin_rb$;
commit;
