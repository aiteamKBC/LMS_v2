# KSB standards migration — readiness report

**Date:** 14 Oct 2026

**Status:** prepared and validated on isolated Neon branches only. **Production has not been migrated, and no profile has been archived or deleted.**

**Production touch so far:** you ran `01_plan.sql` yourself. It only created the planning schema `ksb_mig`, which nothing in the application reads. I checked afterwards: all application data was unchanged.

**Branch:** `New-Modifications`. Nothing has been committed, pushed or deployed. The files another session is editing in the same tree were not touched; `backend/curriculum_api/views.py` is one of them, so its change is delivered as a patch.

## Isolated test environment

| Purpose | Neon branch | State left in |
|---|---|---|
| First dry run and script development | `ksb-standards-migration-dryrun-20261014` (`br-quiet-dust-abgfe0mb`) | applied, rolled back, rolled back again (scratch) |
| Final full-cycle test on fresh production data (copied 13:22) | `ksb-standards-migration-final-test-20261014` (`br-withered-rice-ab6x2kkc`) | **migrated**, plus pin remediation (ready for application testing) |

Both branches are children of `production` in project `LMS` (`green-term-97168878`). Neither has been deleted. Delete them when no longer needed.

## Files

All in `backend/sql/2026-10-14_ksb_standards_migration/` unless shown otherwise.

| File | Purpose |
|---|---|
| `01_plan.sql` | Builds the plan in schema `ksb_mig`. Reads application tables only. Deterministic; rerunnable. |
| `02_apply.sql` | The migration. One transaction, one `DO` block. Precondition checks, full archive of prior values, idempotent writes, post-checks that abort on any difference. |
| `03_rollback.sql` | Restores every value from `ksb_migration_archive`. Detects conflicting later edits instead of overwriting them. Idempotent. |
| `04_pin_remediation_plan.sql` | **Separate** remediation for mislabelled learner pins. Part A is read-only. Part B runs only with `SET ksb_pin_fix.confirm = 'yes'`. Includes its own rollback. |
| `05_reconcile.sql` | Read-only checksums, per-table before/after counts, and the per-learner before/after display table. |
| `06_unresolved_review.sql` | Read-only report for manual review: heading mappings, coverage classes, registered learner rows. |
| `views_ksb_exclusions.patch` | The `curriculum_api/views.py` change (39 lines). It applies cleanly to the current working copy, checked with `git apply --check` only. Apply it after the other session's work on that file has landed. |
| `DRY_RUN_REPORT.md` | The earlier dry-run report. Superseded where this report differs. |

New application files:
- `backend/learner_api/ksb_sources.py`: resolves the applied source, profile or standard.
- `backend/learner_api/ksb_exclusions.py`: the exclusion-registry predicate.

---

## 1. What will change

These counts come from the final test on fresh production data. Production keeps moving, so `01_plan.sql` is rerun just before the apply, and the apply aborts if anything is stale.

| Object | Change | Count |
|---|---|---|
| `curriculum.ksb_mappings` | Manual codes repointed to ST0596 by **description match** (code, `ksb_id` = `<sid>-<standard row id>`, description, source) | 1,488 (1,304 live + 184 already soft-deleted) |
| `curriculum.ksb_mappings` | Live B1–B4 group-heading mappings **soft-deleted in place**, marked `deleted_by = 'ksb-standards-migration:unresolved-group-heading'`. Original row kept in the archive. | 109 |
| `curriculum.components.ksb_mappings` (JSON) | Same repoint. Live heading items removed; their exact JSON is kept in the archive. | 836 components |
| `"Learner".learner_progress_ksbs` | Manual codes repointed (ME → ST0596, MM dotted codes → ST0612). `ksb_definition_id` repointed to the new version's definitions. | 1,294 rows |
| `"Learner".learner_activity_revisions` | One audit revision per changed activity, as the application's own curriculum sync writes. | 591 |
| `"Learner".learner_progress_ksb_exclusions` (**new table**) | Learner rows **left unchanged** but registered as not counting (headings, other-standard rows, orphans). | 99 |
| `curriculum.ksb_profile_versions` / `ksb_definitions` | New versions `standard:st0596-v1-0` (33) and `standard:st0612-v1-0` (42). Same content and SHA-256 key the application would build; the hash was verified against ST0310. | 2 versions, 75 definitions |
| `"Learner".learner_ksb_assignments` | Learners repinned from manual versions: 61 ME → ST0596, 161 MM → ST0612. | 222 |
| `curriculum.programmes` | Marketing Executive Level 4 → `standard:st0596-v1-0` | 1 |
| `curriculum.modules` | That programme's modules → `standard:st0596-v1-0`, as the application's own cascade does | 54 |
| Schema `ksb_migration_archive` (**new**) | Prior values of everything above, the frozen plan, and the run log | — |

**Learner-visible change (accepted on 14 Oct).** Displayed KSB achievement for the 118 Marketing Executive learners moves from an average of **29.8% to 64.7%**: 87 up, 30 down, 1 the same.
- **Up:** imported journal and old LMS rows that use ST0596 numbering (K5–K11, S7–S14, B5–B8) start to count.
- **Down:** credit that rested on manual group headings, which have no ST0596 equivalent, stops counting.
- **Per learner:** `05_reconcile.sql` (c) lists every learner.

**Required decision before Production: repinning conflicts with an explicit code rule.** `replace_learner_ksbs` deliberately never repins existing learners ("historical requirements are not changed retroactively"). Repinning the 222 is still necessary: once the curriculum uses standard codes, a learner left on a manual version would be measured against codes that no longer exist. You approved this as part of the plan; **I need you to confirm it explicitly.**

## 2. What will remain unchanged

- **Every `ksb_profiles` row.** No profile is archived or deleted; checksum identical before and after.
- **Every historical record:**
  - `learner_activity_revisions` (only appended to)
  - review instances and their snapshots
  - reflection submissions
  - monthly reports
  - signed Skills Radar answers (`Wizard_Ksb_Assignments`)
  - `record_revisions` / `record_versions`
  - audit and system-audit tables
- **All 81,666 imported `activity-ssot` rows** (journal, old LMS, Aptem, new LMS). Their codes are trusted as ST0596 (decision of 14 Oct). Their misleading descriptions are **not** rewritten: the description is a lookup from the manual profile (100% of 34,822 described rows), not evidence.
- **455 migrated Aptem rows** that already carry ST0612 codes.
- **Every programme that is not verified:**
  - "Marketing Manager" (LVL-7, archived): blocked.
  - OTHM Level 7 Diploma: unchanged (3A).
  - PCP test programmes.
  - MBA and other programmes on the Empty profile.
- **PCP S28.** Prefix match only, held as `needs_semantic_review`.
- **Teams calendar, meeting and email behaviour.** No Teams file was edited.

## 3. Records that need manual review

**(a) 130 group-heading mappings (B1–B4), Marketing Executive Level 4.** 109 live, soft-deleted by the migration; 21 already deleted. Full list with programme, module, week, component, original KSB, candidate standard KSBs and learners: `06_unresolved_review.sql` (1).

| Heading | Mappings (live / deleted) | Components | Learners who completed them | Candidate standard KSBs (its points) |
|---|---|---|---|---|
| B1 "Agile and flexible" | 12 / 4 | 12 | 1 | B1.1→B1, B1.2→B2 |
| B2 "Creative Thinker" | 1 / 1 | 1 | 3 | B2.1→B3, B2.2→B4 |
| B3 "Resilience…" | 40 / 8 | 40 | 0 | B3.1→B5 |
| B4 "Professionalism…" | 56 / 8 | 56 | 0 | B4.1→B6, B4.2→B7, B4.3→B8 |

**Coverage after the migration (ST0596, 33 KSBs):**
- **Active (23):** K1–K11, S1, S2, S4–S6, S9–S14, B7.
- **Unresolved only (7):** B1, B2, B3, B4, B5, B6, B8. Their only curriculum mappings are the headings above, so they show as unmapped in curriculum coverage until the curriculum team remaps them.
- **None (3):** S3, S7, S8. Unmapped today as well; this gap is not caused by the migration.

**Effect on learners.** Learner achievement for B1–B8 still comes from imported ST0596-coded rows. Only the 4 learners who completed heading-mapped components lose that specific credit; their 6 heading rows are registered, not deleted.

**(b) 99 learner rows registered as not counting.** These rows are unchanged, skipped by achievement readers, and released by setting `status = 'released'`.
- **81 `excluded_group_heading`:** non-SSOT imports such as `aptem-evidence`, `existing-canonical`, `existing-canonical-old-lms` and `old_lms_quiz_*`, carrying a manual heading.
- **9 `excluded_other_standard`:** PCP-coded rows on a Marketing Executive learner (internal id 211, apparently a test account).
- **6 `excluded_group_heading`:** from the plan.
- **3 `excluded_orphan`** (section 3c).

**(c) 3 orphan learner rows.** Preserved and registered; not attached or deleted.

| progress_id | position | learner_id | code | origin | references |
|---|---|---|---|---|---|
| 903190 | 1 | 571 | K1.2 | quiz "AI Assisted Learning P1: Welcome to the Modern Mar…", module "Martech - Fri", passed, submitted 2026-10-05, `component_link_status = valid_legacy_non_component_activity`, no source system, no component, no programme on the entry | learner's other activity is PROG-ME-L4; learner pinned to `standard:st0845-v1-1` (one of the mis-pinned learners) |
| 903190 | 2 | 571 | K2.2 | same activity | same |
| 903190 | 3 | 571 | K4.2 | same activity | same |

**Recovery path (needs your approval).** Once learner 571's pin is corrected (section 6), their profile is unambiguous: Marketing executive. The codes then translate by description: **K1.2→K2, K2.2→K5, K4.2→K10**. Two of the five orphans in the morning dry run acquired a programme during the day and were translated normally.

**(d) PCP S28.** Manual "…to meet project control requirement" vs standard "…requirements" plus further text. Prefix match only, so it needs **semantic confirmation**. It has no mappings or learner rows, so it blocks nothing in this migration.

**(e) Pins held (unchanged), 25:**
- 24 learners on manual versions with no programme in their progress (16 ME, 6 MM, 1 PCP, 1 APM).
- 1 learner on the APM manual version whose programme is a PCP test programme.

**(f) Separate pin remediation (section 6):** 1 learner on the 7-item "Test 25/8" version, and 1 left on version 14 whose main programme is not Marketing Executive.

## 4. Application changes

Status: **implemented on `New-Modifications`, not committed.** Every consumer resolves the **applied** source, whether profile or standard. An applied profile is read **even when archived**; only name-based discovery is limited to active profiles. Programmes that legitimately stay on manual profiles keep working.

| Consumer | File | Change |
|---|---|---|
| Source resolution (new) | `learner_api/ksb_sources.py` | Parses `standard:…` / `KSBP-…` / `profile:…`. Reads standards from `standard_ksbs` and applied profiles regardless of `is_active`. |
| Exclusion registry (new) | `learner_api/ksb_exclusions.py` | Shared predicate. No-op until the registry exists or on non-PostgreSQL. |
| AI marking: EPA plan selection (`_programme_standard`) | `coach_api/ai_marking.py` | Applied profile resolved even when archived. A standard is named directly. |
| AI marking: `load_ksb_framework` | `coach_api/ai_marking.py` | Applied source first (standard or profile). Note: **no callers today**; marking uses component mappings. |
| Skills Radar (enrolment wizard) | `learner_api/curriculum.py` | Standard programmes now get the standard's KSBs. Item id `st0596-v1-0-K1`, whose last segment is the code `board_wizard` reads. Applied profile read even when archived. **Fixed an existing bug:** the discovery query read `ksb_profiles.programme_id/programme_name`, columns dropped in migrations 0019/0020, so it raised for every programme without an applied source. |
| Review form (signed Skills Radar) | `learner_api/review_form.py` | Answers resolve against the source **recorded on the learner's own Skills Radar** (`Standard_id`), archived profiles included; the programme source is the fallback. Signed answers keep their titles after the programme moves to a standard. |
| Learner KSB list / snapshot | `learner_api/active_users.py` | Applied profile read even when archived. |
| Achievement readers (registry applied) | `coach_api/views.py` (caseload KSB %), `learner_api/aptem_ksb_breakdown.py`, `learner_api/student_activity_data.py`, `learner_api/canonical_learning.py` (×3) | Skip registered rows. LEFT joins keep the activity and its hours and drop only the code. |
| Curriculum achievement / OTJH readers | `curriculum_api/views.py`, via **`views_ksb_exclusions.patch`** | Same predicate in both `learner_progress_ksb_totals` definitions and in `learner_progress_ksb_consumption` (LEFT join). |

**Not changed (display or search only):**
- `otjh_ksb.search_ksb_activities`
- `monthly_log_sources`
- curriculum coverage, which already reads all profiles, archived included

**Deployment order:**
1. Code first: these changes plus the `views.py` patch.
2. Then `02_apply.sql`.
3. Then restart the services (`lms-*.service`) so per-process caches drop (production runs 9 services with no Redis).

The code is safe to deploy before the apply: with no registry and no standard sources it behaves exactly as today.

## 5. Is the migration reversible?

**Yes, verified on fresh data.** Before the apply, after the apply, after a rollback and after a re-apply, I took checksums of full rows, `updated_at` included. The rollback restored **byte-for-byte**:
- `ksb_mappings` (1,635 planned rows)
- components (860)
- `learner_progress_ksbs` (planned activities)
- all 486 learner pins
- all programmes and modules
- `ksb_profile_versions` (17)
- `ksb_definitions` (735)
- `ksb_profiles`

The only lasting difference is the audit trail: +591 apply revisions and +591 rollback revisions, by design.

**Second safety net:** a Neon branch or snapshot of production taken immediately before the apply.

## 6. Pin remediation (separate)

**Root cause.** `refresh_learner_ksb_snapshot` resolves the KSB **items** (`_fetch_ksb_items`) and the version **label** (`_resolve_ksb_profile_source_id`) independently. On 25 Aug – 17 Sep the label resolved to `standard:st0845-v1-1`, the standard lookup returned nothing, and the items fell back to the profile found by programme name, the Marketing executive manual profile. The result was version 14: labelled ST0845 (PCP), holding the 47 ME manual items. The 2–11-item "Test 25/8" versions labelled ST0845 show the same split.

**Impact verified:**
- **Learner achievement:** unaffected. Rows are stored independently of pins, and `calculate_ksb_progress` measured them against the correct ME items.
- **KSB coverage:** unaffected; it uses the programme source.
- **AI marking:** unaffected; it does not read pins.
- **Historical reviews:**
  - 0 `review_instances` for these learners.
  - 4 imported coach reviews, all with no progress snapshot.
  - 1 review instance in the whole database carries `sourceId` ST0845, and it is not one of these learners.
- **Visible effect:** the learner-side standard title read "Project controls professional … (Level 6)" for these learners.

**Proposed correction (Part B).** Run after `02_apply.sql`, in its own transaction:
- Repins the **55** learners on version 14 whose programme is Marketing Executive Level 4 to `standard:st0596-v1-0`.
- Leaves for review: 1 learner on the 7-item PCP-content version 8 (content differs, not just the label), and 1 on version 14 whose main programme is not ME.

**Tested:** apply → exact rollback (`updated_at` included) → re-apply → rerun with 0 targets.

**Recommended follow-up, not implemented (needs your approval):** derive the version label from the source the items actually came from, so the split cannot recur.

## 7. Does every learner achievement and component association remain identical?

**For every row the migration translates: yes, verified.**
- The plan reconciles each learner × standard KSB on weight and on the exact set of components: **901 / 901 identical** (44 learners), **0 different**, **0 code collisions**.
- `02_apply.sql` recomputes the same comparison from the live tables after writing and **aborts the whole transaction on any difference**. That actually happened during development: it caught 3 orphan-row differences and rolled everything back before the bug was fixed.
- The 7 learner × KSB pairs that come only from registered rows are reported as moved to review, not lost.

**What learners see: no, and this was accepted.** Changing the required set from 47 manual codes to 33 standard codes changes displayed percentages (section 1).

## 8. Tests

| Check | Result |
|---|---|
| New `learner_api.test_ksb_standards_sources_no_db` (sources, Skills Radar, registry, breakdown) | 16 / 16 pass |
| New `learner_api.tests_ksb_standards_consumers` + `coach_api.tests_ksb_standards_sources` (review-form history, AI marking, canonical readers, caseload) | 13 / 13 pass. SimpleTestCase, no test DB created. |
| Existing tests of the changed files, compared with a clean HEAD worktree run the same day | **No regressions.** 3 modules first broke on my tree (`test_canonical_learning_no_db`, `test_ksb_point_display_no_db`, `test_source_completion_no_db`). They load `canonical_learning` functions into an isolated scope, so the scope gained the two new names, stubbed to "no registry". Now 47 / 3 / 3 pass. 19 Django modules (AI marking, OTJH KSB, case file, learning plan, monthly, weekly, view-as-marking, dashboard, home/module progress, employer, student activity, training plan, subject source, lineage, AI reflection): equal or better than baseline. Failures that exist on HEAD too, with identical counts: `tests_ai_reflection` (1F/3E), `tests_student_activity` (7F/4E), `tests_training_plan_dashboard` (1F/1E), `tests_subject_source` (4F/3E), and 13 `*_no_db` modules (assignment booking/attempts/resubmission, current learning, journal sources, KSB ledger, metrics merge, monthly log history, meeting reminders, review booking status, planned total, extra activities). |
| SQL: transaction rollback on failure | Pass. Data identical to baseline; no archive or registry left behind. |
| SQL: apply / rerun (idempotent) / plan rerun / rollback / rollback rerun / re-apply | Pass. Byte-for-byte rollback; deterministic counts. |
| Pin remediation: apply / rollback / re-apply / rerun | Pass |
| Teams baseline | **NOT REQUIRED.** No Teams file edited (`curriculum_api/views.py` is unchanged; the patch is not applied). **Required once the patch is applied**, since `views.py` is on the Teams list. |
| Frontend type-check / build | **NOT REQUIRED.** No frontend file changed. |
| Application running against the migrated branch | **BLOCKED / NOT RUN.** Needs the branch connection string in a local `.env`. I did not handle credentials. |

## 9. Remaining risks and blockers before Production

1. **Your approvals:**
   - this report, including the accepted percentage change;
   - **repinning 222 learners** against the "never repin" code rule (section 1);
   - the orphan recovery path;
   - pin remediation Part B.
2. **Code review, PR and deploy** of the application changes, plus the `views.py` patch once the other session's `views.py` work lands. Then the Teams baseline and the expanded backend checks for `views.py`.
3. **Run the application against the final test branch** (curriculum coverage, learner dashboard, coach caseload, review form) before Production. This was blocked here (section 8).
4. **Production steps, in order:**
   1. Neon snapshot.
   2. Rerun `01_plan.sql`.
   3. Compare its counts with section 1.
   4. `02_apply.sql`.
   5. `05_reconcile.sql`.
   6. Restart the services.
   7. `04` Part B.
   8. Verify.
5. **Profiles are not archived by any script.** Archiving (`is_active = false`) is a later step, after the code is deployed and verified. **Hard deletion is not recommended at all**: signed assessments reference profile item ids.
6. **Pre-existing, outside scope** (reported, not fixed):
   - "Marketing Manager Level 6" is already on ST0612, and its imported rows carry MM heading descriptions under ST0612 codes. The same lookup artefact as ME, live today.
   - `programme_component_ksb_mapping_count` still falls back from K1.1 to K1 by code; harmless after the migration.
7. **Environment:** the C: drive on this machine is full (94 MB free).
