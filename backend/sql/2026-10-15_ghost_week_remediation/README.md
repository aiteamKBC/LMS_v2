# Ghost week remediation (15 Oct 2026)

## What was wrong

Two running "AI In Marketing" modules each hold 17 old weeks and 297 old components:

- `MOD-20260921085217095815146F2085A499`: G3-Sharon Ai in Marketing Friday
- `MOD-20260921085233798880517CB0D243D0`: G2-Sharon Ai in Marketing Wednesday

How it happened, from `curriculum.record_revisions`:

1. **08:52 on 21 Sep 2026.** Each module was created as a duplicate ("AI In Marketing copy").
2. **08:53.** Both copies were archived (module delete). Each copy's 17 weeks and 297 components were stamped `deleted_via_parent = <module id>`.
3. **13:42.** The module was duplicated again. The create endpoint matched the archived copy by title, programme, cohort and group, and reused its id.
4. **13:42, a few seconds later.** The Builder's follow-up save sent `isProgrammeDeleted: false`. That cleared the archive on the module row only, and wrote a new set of weeks beside the stamped old set.

Learner and coach reads treated any parent stamp as "archived with its module". The old set sorts first, so learners saw week 1 as **Event MasterClass**, every later title one week late, and the old components' hours. A Restore of either module would also have revived the old set: a dry run on a Neon branch gave 33 live weeks per module after archive and restore, instead of 16.

The code fix hides these rows from every learner and coach read, limits Restore and the archive view to rows stamped in the module's own archive moment, and stops both steps of the root cause:

- `curriculum_api/week_visibility.py` and its readers
- `curriculum_api/views.py`

This bundle repairs the data as well.

## What it changes

It clears `deleted_via_parent` (sets it to `NULL`) on exactly:

| Step | Rows | Table |
| --- | --- | --- |
| `02_apply_weeks.sql` | 34 (17 per module) | `curriculum.weeks` |
| `03_apply_components.sql` | 594 (297 per module) | `curriculum.components` |

Every row stays deleted. Nothing else is touched:

- the other columns (`deleted_at`, `deleted_by`, `is_programme_deleted`, `updated_at`, titles, settings)
- any other row, including each module's `module_completion_criteria` and `module_details` rows (see below)
- KSB mappings, learner progress, plans, attendance, KSB achievements and Teams data

Nothing is hard-deleted.

## Run order

| Step | File | Writes? |
| --- | --- | --- |
| 1 | `01_preflight_preview.sql` | No. Check each query against its EXPECT note. |
| 2 | `02_apply_weeks.sql` | Yes, in one transaction. All or nothing. |
| 3 | `03_apply_components.sql` | Yes, in one transaction. All or nothing. |
| 4 | `04_verify.sql` | No. |

Rollback is separate and is not part of the sequence. Run components before weeks:

- `rollback/rollback_components.sql`
- `rollback/rollback_weeks.sql`

Each rollback restores the stamps from its before-image and renames that table with a timestamp, so apply and rollback can be repeated.

## Safeguards

**Pinned targets.** Weeks are pinned by their 34 ids. Components are pinned by the 34 week ids plus an md5 fingerprint of the 297 ids per module, taken on 15 Oct 2026.

**Every row must still match every condition:**

- its module is running;
- it is deleted, by `module-delete`;
- it is stamped with its own module's id;
- it was deleted between 08:53:00 and 08:54:00 UTC on 21 Sep 2026.

Weeks must have no live component. Components must sit on a week that is not live, and no learner plan, quiz link or live KSB mapping may point at them.

**Exact counts.** Anything other than exactly 34 weeks, or 594 components with matching fingerprints, aborts the run with nothing written.

**Runs once.** A second run stops with "Already applied". A rollback with nothing to undo stops too.

**Before-image first.** The old values go to `week_ghost_remediation.weeks_before` and `.components_before` before any update.

**Checked update.** The update re-checks each row's state and must change exactly 34 or 594 rows.

**Post-conditions before COMMIT:**

- no stamped deleted row is left in either module;
- every target is still deleted;
- the before-image is complete.

**Left alone on purpose.** `04_verify.sql` query 7 still lists one `module_completion_criteria` row and one `module_details` row per module as "Restore would revive". Each is that module's only row of its kind, so reviving it on a Restore is correct.

## Status

**Production.** Not run. The preflight queries were run read-only on 15 Oct 2026, and every target met every condition.

**Neon branch `ghost-remediation-dryrun-20261015` (`br-dawn-star-abfbzqw4`).** Dry run on a copy of production, 15 Oct 2026:

- **Preflight.** Every EXPECT note matched.
- **Tamper tests.** With one week or component target altered, each apply aborted ("found 33" / "found 593") and wrote nothing.
- **Apply.** Exactly 34 + 594 rows changed. `04_verify.sql` matched every expectation, and the learner week structure equals the live (Builder) structure for all 16 weeks of both modules.
- **Second run.** It refused with "Already applied".
- **Rollback.** `curriculum.weeks` and `curriculum.components` came back byte-identical to the baseline, by full-table md5 fingerprint.
- **Repeat.** A second apply and rollback cycle behaved the same.
- **Untouched data.** Fingerprints of every other table checked stayed identical at every step: learner progress, KSBs, plans, attendance, live sessions and Teams tables, modules, KSB mappings, completion criteria and details.
- **Restore after apply.** An archive and restore of both modules, run in a transaction that was rolled back, brought back exactly 16 weeks and 252/253 components. Before the apply it brought back 33 weeks and 549/550 components.
