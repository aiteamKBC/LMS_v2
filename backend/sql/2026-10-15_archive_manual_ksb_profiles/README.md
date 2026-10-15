# Retire the manual KSB profiles (15 Oct 2026)

After this, Associate Project Manager L4, Marketing Executive L4, Marketing Manager L6 and Project Controls Professional L6 read their KSBs from the government standards (`curriculum.standard_ksbs`) only.

## Order on Production

1. **Deploy the backend first.** The deploy must include the `build_programmes` fix in `curriculum_api/views.py` (`applied_standard_required_codes`).
   - Without it, the ME and MM programme cards would show a KSB total of 0 once the profiles are archived.
2. **Run** `run_archive_manual_ksb_profiles.sql`, once.
   - Expected notice: `manual KSB profiles retired: 4 Skills Radar source(s) recorded, 5 profile(s) archived`.
   - Any error means nothing changed.
3. **Restart the services:** `systemctl restart 'lms-*.service'`.
4. **Check:** `check_read_only.sql` (read-only). Every profile should be `is_active = false`, and Skills Radar records 21–24 should name `KSBP-20260610080934000011`.

Do **not** run anything under `rollback/` unless you are undoing the change.

## What it changes

- **Four Skills Radar records** (`enrolment."Wizard_Skills_Radar"` ids 21–24) get `Standard_id` = the manual profile their answers were given against.
  - Since Marketing Executive moved to ST0596 on 15 Oct, the review form had shown those signed answers without titles.
  - The answers and `Updated_at` are not touched.
- **The 5 manual profiles** get `is_active = false`.
  - Nothing is deleted. A programme or Skills Radar that names a profile can still read it, but no programme discovers one by name any more.
- **Every changed value** is logged in `ksb_migration_archive.manual_profile_archive`.

Refuses unless all four programmes apply a standard and none of their learners is pinned to a manual profile version.

## Undo

```sql
SET manual_profile_archive.rollback = 'yes';
```
then `rollback/undo_archive.sql`. A value someone changed after the run is reported as a conflict and left as it is.

## Rehearsal (Neon branch `br-holy-hill-abdboars`, copy of Production 15 Oct 08:15 UTC)

**444 learners of the four programmes**, read through the application's own code before and after:
- 0 differences in canonical KSB figures, caseload figures, pins and pinned descriptions.

**Skills Radar**, learners 670/673/674/681:
- before: 80 rows, 47 answers without a title;
- after: 47 rows, every answer with its title.

**Programme cards**, with the `build_programmes` fix: identical before and after.

| Programme | KSB total | Matches the standard |
|---|---|---|
| APM | 62 | ST0310 |
| ME | 33 | ST0596 |
| MM | 42 | ST0612 |
| PCP | 71 | ST0845 |

Without the fix, ME and MM read 47 and 58 from the manual profiles, and drop to 0 after archiving.

**Run twice:** the second run changes nothing.

**Undo restored every value**, with 0 conflicts.
