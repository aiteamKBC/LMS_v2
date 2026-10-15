# Ghost week remediation (15 Oct 2026)

## What was wrong

Two running "AI In Marketing" modules each hold 17 old weeks:

- `MOD-20260921085217095815146F2085A499`: G3-Sharon Ai in Marketing Friday
- `MOD-20260921085233798880517CB0D243D0`: G2-Sharon Ai in Marketing Wednesday

On 21 Sep 2026 a module delete stamped these weeks `deleted_via_parent = <module id>`. The module was later brought back without them, then rebuilt. Learner and coach reads treated any parent stamp as "archived with its module". The old set sorts first, so learners saw week 1 as **Event MasterClass**, every later title one week late, and week 1 with no activities.

The code fix (`curriculum_api/week_visibility.py`, used by every learner/coach week read) already hides these rows. This bundle repairs the data too. Without it, archiving and then restoring either module would bring the 17 old weeks back as live weeks, because module restore matches on that stamp.

## What it changes

It changes exactly 34 `curriculum.weeks` rows: `deleted_via_parent` becomes `NULL`. The rows stay deleted.

It does not touch `deleted_at`, `deleted_by`, `is_programme_deleted` or `updated_at`. It also does not touch components (including the 297 old deleted components per module), KSB mappings, learner progress, attendance, KSB achievements or Teams data. Nothing is hard-deleted.

## Run order

| Step | File | Writes? |
| --- | --- | --- |
| 1 | `01_preflight_preview.sql` | No. Check each query against its EXPECT note. |
| 2 | `02_apply.sql` | Yes, in one transaction. Aborts with nothing written unless all 34 rows still match every targeting condition. |
| 3 | `03_verify.sql` | No. |

Rollback is separate and is not part of the sequence: `rollback/rollback_restore_parent_stamp.sql` puts the stamps back from `week_ghost_remediation.weeks_before`.

## Safeguards in `02_apply.sql`

- The 34 week IDs are pinned. Each row must also belong to one of the two modules, the module must be running, and the row must be deleted by `module-delete` with its own module's stamp, between 08:53:00 and 08:54:00 UTC on 21 Sep 2026, with no live component. Anything other than exactly 34 matches (17 per module) aborts.
- The script refuses to run twice.
- The before-image goes to `week_ghost_remediation.weeks_before` before the update.
- The update re-checks each row's state and must change exactly 34 rows.
- Post-conditions are checked before `COMMIT`: no stamped deleted week is left in either module, all 34 rows are still deleted, and the before-image is complete.

## Status

Not run against any database. Preflight queries 1–4 were run read-only against production on 15 Oct 2026, and all 34 targets met every condition. The `DO` blocks in `02_apply.sql` and the rollback have not been executed. Dry-run both on a Neon branch before production.
