# KSB standards migration: dry-run report

- **Date:** 14 Oct 2026
- **Status:** dry run only. Production has not been modified and no profile has been archived.
- **Database:** Neon project `LMS` (`green-term-97168878`), isolated branch `ksb-standards-migration-dryrun-20261014` (`br-quiet-dust-abgfe0mb`), copied from `production`.
- **Code:** worktree `LMS_v2-ksb-migration`, branch `feature/ksb-standards-migration`, based on `origin/main` @ `8c03d34b`.
- **Plan script:** `01_plan.sql`, kept next to this file. It reads the application tables and writes only to the `ksb_mig` schema on the branch. It is deterministic and idempotent: each run rebuilds `ksb_mig.*` from the current data, and once the plan has been applied, a rerun finds nothing left to repoint.

Decisions applied: **1B, 2B (conditional), 3A**, plus the ten safeguards.

---

## 1. Verdict

| Check | Result |
|---|---|
| Manual → standard matching (description + K/S/B type, one-to-one) | 0 ambiguous, 0 code-only matches |
| Learner achievement, per learner and per standard KSB | **928 / 928 identical** (44 learners), **0 different** |
| Code collisions (two old codes landing on one new code in one progress row) | **0** |
| Learner rows lost | **0**. The 11 rows not repointed are held for review, not deleted |
| Programme migrations that pass identity verification | **1**: Marketing Executive Level 4 → ST0596 |
| Ready to apply to Production | **No.** Blocking items are listed in section 9 |

---

## 2. Matching: manual item → standard KSB

| Profile | Linked standard | Matched | Tier | Group headings | Unresolved |
|---|---|---|---|---|---|
| Marketing executive | ST0596 v1.0 | 33 / 33 standard KSBs | all tier 1 (identical text) | 14 | 0 |
| Marketing Manager | ST0612 v1.0 | 42 / 42 standard KSBs | all tier 1 | 16 | 0 |
| Project Control Professional | ST0845 v1.1 | 71 / 71 | 68 tier 1; B6 and B9 tier 2 (the standard prefixes the text with "Impartial:" / "Innovation:"); **S28 tier 3 (prefix match, needs your confirmation)** | 0 | 0 |
| Associate Project Manager | ST0310 v1.5 | 0 | — | 1 | 1 (test data "11111") |
| Empty KSB profile | none | — | — | — | — |

The codes do **not** correspond between the two sources. Examples from Marketing executive:

| Manual | Standard | Text |
|---|---|---|
| K1.1 | K1 | The fundamentals of marketing theory … |
| K1.2 | K2 | The concepts of brand positioning … |
| B1.2 | B2 | Being a proven 'self-starter' … |
| **B2** (heading "Creative Thinker") | — | Standard **B2** is a different behaviour. Keeping the heading's code would have credited the wrong KSB. |

Full table: `ksb_mig.item_match`.

---

## 3. Programme identity (safeguards 4 and 5)

A programme moves to a standard only when two things hold:
- its name, with "Level N" removed, equals the standard title;
- its level equals the standard level.

| Programme | Status | Current source | Proposed standard | Decision |
|---|---|---|---|---|
| Marketing Executive Level 4 | active | manual: Marketing executive | ST0596 L4 | **migrate** |
| Marketing Manager (`PROG-20260824104138483006`) | archived | manual: Marketing executive | — | **blocked**. Recorded level is LVL-7; ST0612 is Level 6, and its profile links to ST0596. It has 0 mappings, 0 learners and 1 cohort. Decision 2B is **not** applied. |
| OTHM Level 7 Diploma – Al Fanar | active | manual: PCP | — | unchanged (3A) |
| Rewan test, Rewan 2 test, Test, Test fouda, Test-Zyad | archived | manual: PCP | — | unchanged (blocked identity) |
| MBA + 6 test programmes | mixed | Empty KSB profile | — | unchanged (3A) |

Programmes already on a standard are untouched. Marketing Manager Level 6 is already on `standard:st0612-v1-0`.

---

## 4. Curriculum mappings

`curriculum.ksb_mappings`, with each change mirrored in `curriculum.components.ksb_mappings` JSON:

| Action | Live rows | Soft-deleted rows | Modules | Components |
|---|---|---|---|---|
| **repoint** (code, `ksb_id`, description and source → ST0596) | 1,304 | 184 | 4 (+3 deleted) | 649 (+99) |
| **review: group heading** (B1–B4) | 109 | 21 | 2 | 109 (+21) |
| hold: programme not migrating | 0 | 17 | 5 | 6 |
| conflicts with unique index | 0 | — | — | — |

The JSON copy matches the table in every action count above. The one difference is 4 extra live JSON items on 4 components of a programme that is not migrating; they are held unchanged. `week_templates` and `week_template_components` contain no manual KSB items.

**Group-heading mappings (rule 1B).** All 130 are behaviour headings B1–B4. Each sits alone on its component, with no sub-point mapped beside it, so rule 1B never permits removing them. They are kept for manual review with every value preserved. They are excluded from active coverage because their code now means a different standard behaviour, as the B2 example shows.

| Heading | Manual text | Its points → standard |
|---|---|---|
| B1 | Agile and flexible | B1.1→B1, B1.2→B2 |
| B2 | Creative Thinker | B2.1→B3, B2.2→B4 |
| B3 | Resilience and continuous improvement | B3.1→B5 |
| B4 | Professionalism and Emotional Intelligence | B4.1→B6, B4.2→B7, B4.3→B8 |

**Coverage after the repoint.** Marketing Executive Level 4 has live mappings on **23 of 33** ST0596 KSBs:
- B1, B2, B3, B4, B5, B6 and B8 are covered today only through the headings above.
- **S3, S7 and S8 have no mapping today either.** That is an existing curriculum gap, not one caused by the migration.

Until the curriculum team remaps the 109 heading mappings, behaviours will show as unmapped.

---

## 5. Learner progress KSBs

These are rows in `"Learner".learner_progress_ksbs`, the table achievement is calculated from.

| Action | Rows | Learners | Rows counting as achieved |
|---|---|---|---|
| **repoint**: Marketing executive → ST0596 | 1,139 | 41 | 1,118 |
| **repoint**: Marketing Manager → ST0612 (dotted codes) | 136 | 3 | 136 |
| **keep**: already ST0612 codes (migrated Aptem rows, compound source `KSBP-…:st0612-v1-0:…`) | 455 | 1 | 455 |
| **review: group heading** (B1/B2 heading only) | 6 | 3 | 6 |
| **review: no profile** (source-less K1.2-style codes, learner has no programme) | 5 | 2 | 5 |

- 113 of the Marketing Manager rows reference a manual `ksb_definition_id`. The apply step repoints them to the new ST0612 definitions.
- 24 source-less rows belonging to Marketing Executive Level 4 learners are included in the repoint. Their profile comes from their verified programme, not from their code.

### Achievement reconciliation (safeguard 3)

The reconciliation compares **each learner × each standard KSB**. For every pair it checks the achieved weight and the exact set of components that earned it. Both sides use the production rule from `learner_progress_ksb_totals` / `progress_rules`:
- a row counts unless `passed = false`; a quiz must have `passed = true`;
- weight is the maximum per row and code;
- results are deduplicated by learner, component and code.

| Verdict | Learner × KSB pairs | Learners |
|---|---|---|
| identical (same weight, same components) | **928** | 44 |
| different | **0** | 0 |
| moved to review (heading-only credit) | 4 | 3 |

Details: `ksb_mig.recon` and `ksb_mig.merge_check` (empty).

**Potential loss to review.** 3 learners hold credit only on a B1/B2 *heading*, which has no standard equivalent, and 2 learners hold 5 source-less rows with no programme. That is 11 rows in total. Nothing is deleted: those rows are kept in the review set until someone decides which standard behaviour each represents.

---

## 6. Learner KSB pins

These are rows in `"Learner".learner_ksb_assignments`. Each learner's programme is taken from their own progress rows, because the version labels are wrong: for example, the Marketing Manager manual version is labelled "MBA".

| Action | Learners | From | To |
|---|---|---|---|
| **repin** | 61 | manual: Marketing executive | `standard:st0596-v1-0` (new version, 33 definitions) |
| **repin** | 161 | manual: Marketing Manager | `standard:st0612-v1-0` (new version, 42 definitions) |
| hold: no programme | 24 | manual (16 ME, 6 MM, 1 PCP, 1 APM) | unchanged |
| hold: programme mismatch | 1 | manual APM, learner on "Test fouda" | unchanged |
| **pre-existing defect** | **56** | `standard:st0845-v1-1` (**PCP**) | learners on Marketing Executive Level 4. Not part of this migration: proposed fix to ST0596, **needs your approval** |

No standard version exists yet for ST0596 or ST0612. The apply step creates them.

---

## 7. Historical records (safeguard 7): untouched

| Store | Rows referencing the manual profiles or dotted codes | Treatment |
|---|---|---|
| `"Learner".learner_activity_revisions` | 349 | kept as is |
| `"Learner".learning_reflection_submissions` (dotted `ksb_codes`) | 98 | kept as is. Curriculum impact drill-downs will need a read-time translation through `item_match`, otherwise these declarations drop out of the filter. |
| `enrolment."Wizard_Ksb_Assessments"` (signed initial assessment) | 188 answers, 47 manual item ids | kept as is. Readers must still resolve the archived profile's items. |
| `curriculum.record_versions`, review snapshots, monthly reports | 0 | — |

---

## 8. Application dependencies (safeguard 6)

Every reader below filters `ksb_profiles` on `is_active`. Archiving a profile would make it return nothing. That includes programmes **already** on a standard: AI marking resolves `standard:st0845-v1-1` back to the PCP manual profile.

| Consumer | File | Effect of archiving today | Change required |
|---|---|---|---|
| AI marking | `coach_api/ai_marking.py` (~395–530) | Loses the KSB list for every standard-sourced programme | Read `standard_ksbs` for `standard:` sources |
| Skills Radar / enrolment wizard | `learner_api/curriculum.py` (~164–252) | Empty KSB step | Read the programme's standard; keep the archived profile readable for old answers |
| Review form | `learner_api/review_form.py` (~132–190) | Old answers listed as unmatched | Resolve archived items by id (history only) |
| Learner KSB list / plan | `learner_api/active_users.py` `_fetch_ksb_items*` (~1627–1798) | Falls back to plan mappings | Read `standard_ksbs` for `standard:` sources |
| Curriculum coverage / mapping | `curriculum_api/views.py` (`profile_required_ksbs`, `infer_mapping_source_from_module`, picker) | Unsourced manual codes stop resolving | Covered once mappings carry the standard source; manual picker read-only |
| Programme card count | `curriculum_api/views.py` `programme_component_ksb_mapping_count` | Matches by code alone, parent fallback K1.1 → K1 | Becomes correct once codes are standard; remove the parent fallback |

These code changes must be merged and deployed **before** any profile is archived.

---

## 9. Blocking conditions: Production apply is not allowed until all are cleared

1. **Your approval** of this report.
2. **S28 (PCP)** tier-3 match confirmed. PCP has no mappings or progress to move, so this only matters for its pins and history.
3. The **56 Marketing Executive learners pinned to ST0845**: fix in this migration, or keep separate.
4. **Group-heading review**: 130 mappings plus 6 learner rows. Approve "keep for curriculum-team review, excluded from coverage", or provide the mapping.
5. The **consumer code changes** in section 8 are merged and deployed.
6. A **Neon snapshot/branch of production** is taken immediately before the apply, and the plan is rerun on it. The plan's counts must equal this report's, or the apply aborts.
7. The apply script asserts, inside its transaction, that `recon` has no `DIFFERENT` rows and `merge_check` is empty, or it rolls back.

---

## 10. Rollback preparation

- Every plan table stores the complete prior values:
  - `mapping_plan`: old code, `ksb_id`, description and source;
  - `component_json_plan`: the full old JSON item;
  - `progress_plan`: old code, source and definition id;
  - `pin_plan`: the old version id.
- The apply step will copy these into a permanent `ksb_migration_archive` schema before writing.
- `03_rollback.sql` restores from that schema by primary key.
- A pre-apply Neon branch gives a second, whole-database restore point.
- **Not yet written:** `02_apply.sql` and `03_rollback.sql`. They are pending approval of this report. No Django migration is used (safeguard 10).
