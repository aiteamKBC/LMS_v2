-- Undo run_delete_manual_ksb_profiles.sql (only if needed).
--
-- Puts each deleted profile back exactly as it was copied. A profile whose id
-- exists again (someone recreated it) is a CONFLICT: it is left as it is and
-- counted in a notice. Restored log rows are stamped restored_at (kept, never
-- deleted). Runs only when explicitly confirmed:
--   SET manual_profile_delete.rollback = 'yes';
-- Idempotent: a second run finds nothing left to restore.

begin;
do $undo$
declare
  v_restored bigint;
  v_conflicts bigint;
begin
  if coalesce(current_setting('manual_profile_delete.rollback', true), '') <> 'yes' then
    raise notice 'skipped: set manual_profile_delete.rollback = yes to restore the deleted profiles';
    return;
  end if;
  if to_regclass('ksb_migration_archive.manual_profile_deletions') is null then
    raise notice 'nothing to restore: run_delete_manual_ksb_profiles.sql never ran';
    return;
  end if;

  with pending as (
    select d.id as log_id, d.profile_row
      from ksb_migration_archive.manual_profile_deletions d
     where d.restored_at is null
       and not exists (select 1 from curriculum.ksb_profiles kp where kp.id::text = d.profile_id)
  ), restored as (
    insert into curriculum.ksb_profiles
    select (jsonb_populate_record(null::curriculum.ksb_profiles, p.profile_row)).*
      from pending p
    returning id
  )
  update ksb_migration_archive.manual_profile_deletions d
     set restored_at = now()
    from restored r
   where d.profile_id = r.id::text and d.restored_at is null;
  get diagnostics v_restored = row_count;

  select count(*) into v_conflicts
    from ksb_migration_archive.manual_profile_deletions d
   where d.restored_at is null;

  raise notice 'manual KSB profiles restored: %, conflicts left as they are: %', v_restored, v_conflicts;
end
$undo$;
commit;
