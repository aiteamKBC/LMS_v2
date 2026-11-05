# Delete the unused manual KSB profiles (18 Oct 2026)

KSBs come from the government standards (`curriculum.standard_ksbs`) only. The manual profiles were archived on 15 Oct (`2026-10-15_archive_manual_ksb_profiles`). This bundle deletes the ones nothing reads any more.

## Order on Production

1. **Deploy the frontend first.** The deploy removes the KSB Frameworks page and the Programmes "Assign empty profile" button, so no new manual profile is created after the delete.
2. **Check:** `check_read_only.sql`. It lists each profile, what still names it, and whether the run deletes or keeps it.
3. **Run** `run_delete_manual_ksb_profiles.sql`, once.
   - Expected notice: `manual KSB profiles: N deleted, M kept because a record still names them`.
   - Any error means nothing changed.
4. **Restart the services:** `systemctl restart 'lms-*.service'`.
5. **Check again:** `check_read_only.sql`. Only profiles marked `kept` remain.

Do **not** run anything under `rollback/` unless you are undoing the change.

## What it keeps, and why

A profile stays while any record still names it:
- programmes, modules, `ksb_mappings`, component mapping items;
- learner pins (`ksb_profile_versions`) and `"Learner".learner_progress_ksbs`;
- **signed Skills Radar records**, which the 15 Oct run pointed at `KSBP-20260610080934000011` so their answers keep their titles.

Deleting a profile those records name would strip the titles from signed learner history, so at least that one profile is expected to stay (archived, `is_active = false`).

## What it changes

- Each unreferenced profile is copied whole into `ksb_migration_archive.manual_profile_deletions`, then deleted from `curriculum.ksb_profiles`.
- Refuses unless every manual profile is already archived.
- **Run twice:** the second run changes nothing.

## Undo

```sql
SET manual_profile_delete.rollback = 'yes';
```
then `rollback/restore_deleted_profiles.sql`. A profile id that exists again is reported as a conflict and left as it is.

Undo this bundle **before** `2026-10-15_archive_manual_ksb_profiles/rollback/undo_archive.sql`, if both are ever undone.
