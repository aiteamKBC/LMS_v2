-- Undo run_archive_manual_ksb_profiles.sql (only if needed).
--
-- Restores each value that run changed, while the record still holds the value
-- the run gave it. A record changed since is a CONFLICT: it is left as it is and
-- counted in a notice. Restored log rows are stamped rolled_back_at (kept, never
-- deleted). Runs only when explicitly confirmed:
--   SET manual_profile_archive.rollback = 'yes';
-- Idempotent: a second run finds nothing left to restore.

begin;
do $undo$
declare
  v_radar bigint;
  v_profiles bigint;
  v_conflicts bigint;
begin
  if coalesce(current_setting('manual_profile_archive.rollback', true), '') <> 'yes' then
    raise notice 'skipped: set manual_profile_archive.rollback = yes to undo the archive';
    return;
  end if;
  if to_regclass('ksb_migration_archive.manual_profile_archive') is null then
    raise notice 'nothing to undo: run_archive_manual_ksb_profiles.sql never ran';
    return;
  end if;

  with restored as (
    update enrolment."Wizard_Skills_Radar" r
       set "Standard_id" = m.before_value ->> 'Standard_id'
      from ksb_migration_archive.manual_profile_archive m
     where m.kind = 'skills_radar' and m.rolled_back_at is null
       and r.id::text = m.record_key
       and r."Standard_id" is not distinct from (m.after_value ->> 'Standard_id')
    returning m.id
  )
  update ksb_migration_archive.manual_profile_archive m set rolled_back_at = now()
    from restored x where m.id = x.id;
  get diagnostics v_radar = row_count;

  with restored as (
    update curriculum.ksb_profiles kp
       set is_active = (m.before_value ->> 'is_active')::boolean
      from ksb_migration_archive.manual_profile_archive m
     where m.kind = 'profile' and m.rolled_back_at is null
       and kp.id::text = m.record_key
       and kp.is_active is not distinct from (m.after_value ->> 'is_active')::boolean
    returning m.id
  )
  update ksb_migration_archive.manual_profile_archive m set rolled_back_at = now()
    from restored x where m.id = x.id;
  get diagnostics v_profiles = row_count;

  select count(*) into v_conflicts
    from ksb_migration_archive.manual_profile_archive where rolled_back_at is null;

  raise notice 'manual KSB profile archive undone: % Skills Radar source(s), % profile(s) restored; % conflict(s) left as they are',
    v_radar, v_profiles, v_conflicts;
end
$undo$;
commit;
