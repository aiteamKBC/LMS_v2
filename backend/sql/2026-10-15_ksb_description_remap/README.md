# KSB description remap (15 Oct 2026)

Learner KSB records in Marketing Executive L4 (ST0596) and Marketing Manager L6 (ST0612) that still carry a manual dotted code (K1.2, S5.1 ...) are attributed to the government standard KSB **whose description is the same text**. The code, number, prefix and position are never used.

| Manual record | Before | After |
|---|---|---|
| K1.2 "The concepts of brand positioning and management ..." | shown as K1.2, counted as **K1** | **K2**, with the standard's description |
| K2.1 "The characteristics and plans of the business ..." | shown as K2.1, counted as **K2** | **K4** |

The full mapping (manual code, manual description, standard code, standard description, status, affected records) is in [MAPPING_REPORT.md](MAPPING_REPORT.md).

## Rules

- **Match on text:** the description must be identical, ignoring only case, spacing and punctuation. One extra form is accepted: identical once the standard's leading label is removed ("Impartial: ...").
- **One match only:** exactly one standard KSB must match, within the standard the learner's programme applies, and it must be the same type (K/S/B).
- **Anything else is left unchanged and listed for review:** no match, two matches, a type clash, or an empty description.
- **Scope:**
  - the learner's programme is APM L4, ME L4, MM L6 or PCP L6;
  - the programme applies a standard;
  - the learner is pinned to that same standard.
- **Changed per record:** only `ksb_code`, `ksb_description` and the definition link.
- **Never touched:**
  - source, evidence links, weight, completion, timestamps;
  - the progress entry itself;
  - soft-deleted entries;
  - rows in the exclusion registry;
  - raw evidence and submission records (Aptem evidence, quiz answers, reflection submissions).

## Order on Production

1. **Run** `01_plan.sql`. It writes only to the `ksb_remap` schema.
   - Expected summary: progress `remap` 2,494, journal `remap` 174.
   - Review `ksb_remap.mapping_report` and `ksb_remap.learner_effect`.
2. **Run** `02_apply.sql` once, in the same session window.
   - Expected notice: `learner_ksb_rows_remapped: 2494`, `journal_rows_learner: 38`, `activity_revisions_written: 612`.
   - Any error means nothing changed; re-run `01_plan.sql` if it says the plan is stale.
3. **Restart the services:** `systemctl restart 'lms-*.service'`. Cached KSB figures are per process.

There are no code changes; nothing needs deploying.

Do **not** run anything under `rollback/` unless you are undoing the change.

## Undo

```sql
SET ksb_remap.rollback = 'yes';
```
then `rollback/undo_remap.sql`. Only values that still hold what the remap wrote are restored; anything edited since is reported as a conflict and left as it is.

## Rehearsal (Neon branch `br-calm-waterfall-abpz9k3d`, copy of Production 15 Oct 09:59 UTC)

**Matching:** 70 manual code + description pairs, all exact text, all one-to-one, all the same type.
- ME: 1,170 progress rows and 174 journal items.
- MM: 1,324 progress rows.
- For 2,382 of these records, the old prefix rule named a different standard KSB.

**Left unchanged and listed:**
- 95 rows on soft-deleted entries;
- 4 rows already in the exclusion registry;
- 3 PCP journal items (learners 287 and 646) that carry Marketing Manager descriptions, which have no match in ST0845.

APM and PCP have no dotted learner records.

**Application readers, 65 affected learners, before and after:**

| Reader | Result |
|---|---|
| Caseload KSBs achieved (code count) | 29 learners up, 3 down, 33 unchanged. The application's codes equal the plan's `after_codes` for all 65 |
| Learner dashboard KSB % (points) | identical for all 65 |
| Learner KSB detail | now lists standard codes and descriptions |

**The 3 decreases** are codes that only the prefix rule had credited, with no record whose description is that standard KSB:
- one learner: K2 and S5;
- one learner: K2;
- one learner: S5.

The records themselves are kept and now count toward the KSB their description names.

**Other checks:**
- The failure hook rolls back completely.
- A second run changes nothing.
- Undo restored 2,494 rows and 38 journal rows with 0 conflicts; the application output was identical to before.
- Re-applying after the undo gave the same result.
