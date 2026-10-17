# KSB standards migration: final validation report

> **Update 15 Oct: decisions taken and re-validated. Status: GO, using `RUNBOOK.md`.**
> The owner delegated the open decisions:
> - **(a)** the 81 assumption-based rows are no longer registered and keep counting, as they do today (`01_plan.sql`: statuses `valid_code_lookup_text` / `valid_code_no_text`);
> - **(b)** the 222 repins and `04` Part B (55) go ahead;
> - **(c)** learners 271, 211 and 212 and the orphans are left as they are; `07` is not part of the release.
>
> **Fresh rehearsal** on a copy of Production (`br-sweet-boat-ab8c7tz8`, 15 Oct 07:06 UTC), in the runbook's exact order:
>
> | Step | Result |
> |---|---|
> | Apply | 1,328 rows repointed, 222 repins, 19 rows registered, recon 936 identical / 0 different |
> | Protected fingerprints | Identical after the apply |
> | `04` Part B | 55 repinned |
> | Rollback (`04b` then `03`) | Byte-identical restore of touched and protected tables |
> | Re-apply | OK |
>
> **What learners see** (application code, before → after):
> - **ME canonical:** 94.8% → 94.9%. All 118 keep a figure; 3 change by at most 1.1 points.
> - **MM canonical:** 86.2% → 86.2%, 0 changes.
> - **Caseload fallback:** ME 80.3% → 66.1%, MM 81.3% → 74.3%, because the denominator becomes the standard's codes.
>
> **Defect found and fixed in the other session's guard** (`03` and `04b`): it read `ksb_migration_archive.orphan_fix_before` inside the same `IF` condition as its existence check. PL/pgSQL fails on that when `07` never ran, so the Production rollback would have failed. Fixed with a nested `IF` and re-tested.
>
> **Still open, not blocking:**
> - the BLOCKED Teams/OTJH DB suites;
> - a UI click-through;
> - `pin_label_fix.patch` (separate PR);
> - remapping the B1–B4 headings (curriculum team; new completions of those components stop carrying headings after the apply).
>
> **Production execution (15 Oct 2026, by the owner):**
> - First `02` attempt (10:31) refused with "stale plan: 3 new manual learner KSB rows" and rolled back; nothing changed.
> - `01` and `02` were then run together: **applied at 07:39:41 UTC (attempt 2)**.
> - Pin remediation applied: 55 learners moved (archived in `ksb_migration_archive.pin_fix_before`).
> - Verified read-only afterwards:
>   - PROG-ME-L4 is on `standard:st0596-v1-0`;
>   - 116 pins on ST0596, 162 on ST0612;
>   - 19 rows registered;
>   - only learner 271 is left on v14, by decision.
>
> Rollback, if ever needed: `04b` (with `ksb_pin_fix.rollback = 'yes'`), then `03`.
>
> Sections 0–12 below are the 14 Oct analysis; where they conflict with this box, this box wins.

**Date:** 14–15 Oct 2026
**Decision:** **NO-GO for Production as it stands.** The SQL is mechanically safe and reversible. Three business decisions are still open, and they come from evidence that contradicts the readiness report (sections 1, 6 and 8).

Nothing in this phase wrote to Production. Validation ran on isolated Neon branches only. I made no commits, pushes or deployments.

This report supersedes `READINESS_REPORT.md` wherever the two differ.

---

## 0. Things you need to know first

1. **`02_apply.sql` has already been run on Production, then rolled back.**
   - Production's own `ksb_migration_archive.run_log` shows `applied_at` **14 Oct 13:53:45 UTC** and `rolled_back_at` **13:54:24 UTC** (attempt 1, 0 conflicts).
   - **Who ran it (resolved 15 Oct):** the owner ran the six bundle files in sequence after the readiness report. `02` applied, `03` rolled it back, `04` Part B skipped (no confirmation), and `05`/`06` are read-only. That matches the run log exactly. An earlier single-file attempt failed and was rolled back by its own transaction. **Lesson:** the bundle must never be run as a numbered sequence; `03` and `04b` are only for rollback.
   - **What it left behind:** every value was restored. I checked mappings, components, learner KSB rows, pins, programmes and modules against the archive: 0 differences.
   - **What remains on Production:**
     - 1,186 `learner_activity_revisions` rows (593 apply + 593 rollback, source `ksb-standards-migration`);
     - the `ksb_migration_archive` schema;
     - an **empty** `"Learner".learner_progress_ksb_exclusions` table;
     - the `ksb_mig` plan schema.
   - **Activity during the window:** 3 learner activities were submitted. All belong to other standards or carry no KSBs, and none were affected.
2. **The application code is already on `main`.**
   - Commit `967f53cc` reached `origin/main` through **PR #386, merged 14 Oct 15:35 +0100**, outside this session.
   - I can't see whether `/var/www/LMS_v2` has deployed it.
   - **It is verified safe to run before the apply.** I ran the old code and the merged code against the same unmigrated copy of Production. Across all 279 affected learners (118 ME, 161 MM), the canonical KSB figure, the caseload fallback, the pins and the programme figure were identical: **0 differences**.
3. **Another session is editing this folder right now.** It added `04b_pin_remediation_rollback.sql`, `07_orphan_recovery.sql` and `07b_orphan_recovery_rollback.sql`, added a guard to `03`, and changed a comment in `04`. **I have not validated those files.**
   - My `03` and `04` validation covers the committed versions.
   - The new `03` guard is additive.
   - The `04` change is a comment only.

## 1. The 29.8% → 64.7% figure is not what anyone sees (item 8)

The readiness report said displayed KSB achievement for the 118 ME learners moves from 29.8% to 64.7%, and that was accepted on 14 Oct.

**That figure comes from the plan's own model** (`ksb_mig.learner_display`):

| | Numerator | Denominator |
|---|---|---|
| Before | Distinct manual codes achieved | 47 |
| After | Distinct ST0596 codes achieved | 33 |

I ran **the application's own readers** against an unmigrated copy of Production and the migrated rehearsal copy. **No screen I measured shows that figure:**

| Reader (application code) | Where it is shown | ME before | ME after | MM before | MM after |
|---|---|---|---|---|---|
| `canonical_learning.metrics_bulk`: KSB points (completed ÷ total activity-KSB points) | Learner dashboard and coach caseload (primary) | **94.8%** (118) | **94.7%** (115) | 86.2% | 86.2% |
| `caseload_dashboard_progress_projections`: distinct parent codes ÷ pinned items | Caseload fallback when canonical is unavailable | 80.3% (denominator 14) | 65.0% (denominator 33) | 81.2% (16) | 74.2% (42) |
| `programme_learner_ksb_progress`: consumed ÷ mapped weight | Curriculum programme page | 1% (13 codes) | 1% (23 codes) | | |
| Plan model `learner_display` | Not shown on any screen I measured | 29.8% | 64.8% | | |

**Canonical figure, per learner (ME):**
- 105 learners are unchanged.
- 10 drop by less than 1.3 points.
- **3 learners lose their KSB figure entirely.** They were "3/3, 100%"; after the migration the status is "empty". Their only KSB rows are now registered as not counting.
- 31 learners see their point *counts* shrink. Excluded rows leave both completed and total.

**Canonical figure, MM:** 3 of 161 change.

**Every** canonical change comes from the exclusion registry, not from the repoint or the repin. Canonical does not read pins.

Per-learner evidence (internal ids only, kept outside the repository): `D:\ksb_val\out\per_learner_compare.csv`, `mm_before.json` and `mm_after.json`.

**Decision needed:** re-confirm the accepted learner-visible change against these numbers.

## 2. Repinning the 222 learners (item 4)

The repin itself is verified on fresh data:

| | Count | Before | After |
|---|---|---|---|
| ME | 61 | `KSBP-…011` (47 items) | `standard:st0596-v1-0` (33) |
| MM | 161 | `KSBP-…013` (58 items) | `standard:st0612-v1-0` (42) |

- 0 rollback conflicts.
- Rollback is byte-for-byte.
- **Effect on screens:**
  - **Canonical:** none, because canonical ignores pins.
  - **Caseload fallback:** the denominator changes (table above).
  - **Learner-side standard title:** changes.
  - **Skills Radar / review form:** signed answers keep resolving against the source recorded on the learner's own Skills Radar. Covered by unit tests; not exercised end to end.
- **Still needs your explicit confirmation:** the repin overrides the code rule "existing learners are never repinned" (`replace_learner_ksbs`).

## 3. The 55-learner pin issue (item 5), kept separate

**Verified from data and code history:**
- **The version selection:** `replace_learner_ksbs` uses get-or-create on (label, content hash). Once a version exists, every refresh with the same label and content reuses it, and existing pins never move.
- **Version 14:**
  - created **2 Sep 08:31**;
  - label `standard:st0845-v1-1`;
  - content: the 47 ME manual items;
  - programme column: "Marketing Executive Level 4".
- **The split:** `refresh_learner_ksb_snapshot` resolves the label (`_resolve_ksb_profile_source_id`) and the items (`_fetch_ksb_items`) **independently**. When the label's source yields no items, the items fall back to the profile found by programme name, but the label is kept.
- **ST0845 rows were not missing.** `standard_ksbs` has held ST0845 since 8 Jul. Code that reads `standard:` labels from `standard_ksbs` arrived in `1fad8dc9` on 12 Sep.
- **The 55 learners:**
  - all have the learner programme "Marketing Executive Level 4" and entry programme PROG-ME-L4;
  - assigned 11 Sep (10) and 17 Sep (45);
  - last touched by a batch on 29 Sep 03:36–05:31.
- **The readiness report's dates were wrong.** It said "pinned 25 Aug – 17 Sep"; that is when the ST0845 test versions appeared.

**Not verified:** why the label resolved to ST0845 for ME learners.
- Production's revision log for PROG-ME-L4 starts on 16 Sep, so its source before then is unknown.
- The 17 Sep assignments contradict the 16 Sep revision showing PROG-ME-L4 on its manual profile, unless the deployed code at that time predates `1fad8dc9`. Deployment history is not visible to me.

**Remediation (`04` Part B), tested on the rehearsal copy:**
- 55 repinned.
- A rerun changes 0.
- Its rollback restores the pins byte-for-byte.
- It touches nothing else.

**Not handled by Part B, needs a decision:**
- **Learner 271:** on v14 and an ME learner, but has no progress entries, so Part B skips them. The readiness report described them as "main programme not ME", which is not accurate.
- **Learners 211 and 212:** on v8, a 7-item test version holding PCP content.

**Code fix, separately reviewable and NOT applied:** `pin_label_fix.patch`.
- It labels a version with the source the items actually came from; a fallback uses the programme id instead of an unrelated standard.
- It adds 3 tests and moves one existing test's mock to the new seam.
- **Tests with the patch applied temporarily** (the tree was restored byte-identical afterwards):

| Suite | Result |
|---|---|
| New tests | 3/3 |
| `LearnerKsbSnapshotTests` | 20/20 |
| KSB source / consumer suites | 16/16, 6/6, 7/7 |

## 4. The 99 learner rows registered as not counting (item 6)

| Registration | Rows | Learners | Evidence |
|---|---|---|---|
| Plan heading rows (`framework` source, manual profile) | 6 | 3 | **Evidence-backed:** manual source on the row |
| `excluded_other_standard` | 9 | 1 (a test account) | **Evidence-backed:** explicit `st0845-v1-1` source |
| `excluded_orphan` (K1.2, K2.2, K4.2) | 3 | 1 | **Evidence-backed:** no source, no programme on the entry |
| Imported heading rows (journal Aptem / existing-canonical / old-LMS quiz, old-LMS existing-canonical, exact-activity mapping) | 31 | 8 | **Not evidence.** 100% carry the manual profile's text for the same code: the same lookup artefact the 14 Oct decision rejected as evidence for SSOT rows. All codes are valid ST0596 codes. |
| New-LMS heading rows with no description | 50 | 18 | **No evidence either way.** Excluded only because the code equals a manual heading code. Their components carry no manual-heading mapping for that code, archived or live. |

**Effect on what learners see:** all 13 canonical percentage changes and the 3 lost figures come from the last two groups (81 rows).

**Decision needed:** these 81 exclusions rest on an assumption. The options:
- **(a)** treat them like SSOT rows and do not register them; their codes then count as ST0596;
- **(b)** keep them registered and pending review, accepting the 3 lost figures;
- **(c)** something else.

## 5. Manual review items (item 7): no mapping was assumed

- **130 B1–B4 heading mappings:** full list with programme, module, week, component, original code and text, already-deleted flag, candidate standard KSBs and learners in `06_unresolved_review.sql` (1).
  - The candidates come from description matches of each heading's own sub-points; choosing one is a curriculum decision. I did not choose.
  - Coverage after the migration (`06` (2)):
    - 23 active;
    - B1–B6 and B8 unresolved-only;
    - S3, S7 and S8 unmapped, as they already are today.
- **3 orphan rows** (one learner, one quiz on 5 Oct):
  - After Part B the learner is on the ST0596 version.
  - The ME manual items K1.2, K2.2 and K4.2 have text identical to ST0596 K2, K5 and K10.
  - That their source *was* the ME profile is an inference from the learner's only programme; it is not recorded on the rows.
  - The other session's `07_orphan_recovery.sql` acts on this inference. It needs your approval and my validation.
- **PCP S28:** the manual text equals the standard's text except for the last character ("…requirement" vs "…requirements."). That looks like truncation, but it needs semantic sign-off. No mappings or learner rows use it.

## 6. Protected records (item 9)

**What was fingerprinted:** 68 objects, each as row count plus an order-independent 64-bit hash of every row (`08_verify_protected.sql`):
- `ksb_profiles`;
- review instances, answers, signatures, reopens and overrides;
- review templates;
- `record_revisions` / `record_versions`;
- reviews, review documents and sections;
- progress-review runs and snapshots;
- monthly signatures, reports and locks;
- reflection submissions;
- all progress entries;
- evidence items, files and overrides;
- activity, journal and evidence KSB tables;
- Wizard KSB assessments and Skills Radar;
- audit sign-offs;
- migrated review signatures and documents;
- **all Teams / calendar tables:** occurrences, attendance, recordings, sync state, integrity events, create claims, schedule emails, module shares, coach meeting tables;
- modules and programmes minus their KSB source column;
- components minus their KSB JSON;
- everything outside the plan in `ksb_mappings`, `learner_progress_ksbs` and pins;
- pre-existing versions and definitions;
- `standard_ksbs`.

**Results:**
- **Identical** before the apply, after the apply, and after the rollback.
- Touched tables (`09_verify_touched.sql`) were **byte-identical** after the rollback, `updated_at` included.

## 7. Production readiness of the scripts

**Fresh rehearsal from Production at 14:01 UTC, in Production's real state** (already applied once and rolled back):

| Step | Result |
|---|---|
| `01` plan | Matches the readiness report except for live drift: 1,300 learner rows / 593 activities, vs 1,294 / 591 |
| Counts | 1,488 repointed, 109 soft-deleted, 836 components, 99 registered, 222 repins, recon 906 identical, 0 different, 0 collisions |
| `02` | Attempt 2 then attempt 3 applied (4 s each). Rerun is a no-op. |
| `04` Part B | 55 repinned, rerun 0 |
| `03` with Part B still applied | Refused (guard added) |
| Part-B rollback, then `03` | Byte-identical restore |

**Defects found and fixed during this phase:**
1. **`02_apply.sql`, re-apply after a rollback (Production's current state):** archives used `ON CONFLICT DO NOTHING`, so they kept attempt 1's copies. A later rollback would have restored those stale values over any edit made since.
   - **Fix:** a new attempt copies the previous archive to `<table>_a<n>` (kept, never deleted) and archives the current values.
   - **Tested:** a simulated edit made between attempts was restored correctly.
   - Also fixed: `applied_at` now records the current attempt.
2. **`03_rollback.sql` ignored `04` Part B.** Rolling back first would have left 55 learners on a version whose programme reverted, and silently kept that version.
   - **Fix:** `03` now refuses until Part B is rolled back.

## 8. Tests (item 2)

| Check | Result |
|---|---|
| Frontend Teams baseline `npm --prefix frontend run test:teams` (required: `curriculum_api/views.py` is a Teams file) | **PASS:** 9 files, 118 tests |
| `npm --prefix frontend run type-check` | **PASS** |
| 53 no-DB backend labels: KSB, curriculum, achievement, OTJH, coach, review pack, Teams SimpleTestCase classes | **No regressions.** Same labels run on a clean HEAD worktree: the working tree is equal or better in every one. All KSB/curriculum/achievement suites pass. Failures identical at HEAD: `tests_student_activity` 7F/4E, `tests_training_plan_dashboard` 1F/1E, `tests_subject_source` 4F/3E, `tests_ai_reflection` 1F/3E, `test_ksb_ledger_no_db` 1E. |
| Expanded backend Teams/DB suites in the repo's guarded branch mode on the scratch branch | **PASS:** `tests_calendar_race` 16, `tests_errors` 3, `ProgrammeLearnerKsbProgressTests` 3, `test_ksb_generation` 4, `test_canonical_metrics_bulk_no_db` 8 |
| `coach_api.tests` 12F, `tests_security` 19E (same mode) | **Identical at clean HEAD:** pre-existing |
| `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`, `ComponentOwnedKsbMappingTests`, `ModuleTotalOtjhTests`, `tests_review_otjh`, `tests_programme_module_counts` | **BLOCKED.** Their `setUp` deletes every authoring row, which a populated Production clone refuses (FK RESTRICT; each test rolled back). sqlite cannot build a test database. Needs an empty Postgres test database. |
| Application end to end against the migrated branch | **PASS** for the readers in section 1, run through the application's own code |
| UI click-through | **NOT RUN** |
| Live Teams | **NOT RUN** (not authorised, not required: no Teams behaviour changed) |

## 9. GO / NO-GO checklist

**Blocking (all must be resolved before GO):**
- [x] Confirm who ran `02`/`03` on Production at 13:53 UTC on 14 Oct: the owner, running the six files in sequence (resolved 15 Oct).
- [ ] Re-confirm the learner-visible change against section 1 (not 29.8% → 64.7%).
- [ ] Decide the 81 assumption-based exclusions (section 4).
- [ ] Explicitly confirm the 222 repins against the "never repin" rule.
- [ ] Approve or decline `04` Part B (55 learners), and decide learners 271, 211 and 212.
- [ ] Have the other session's `04b`, `07` and `07b` reviewed and validated, or keep them out of the run.
- [ ] Confirm whether the deployed Production revision includes PR #386. It is safe either way: verified identical behaviour before the apply.

**Recommended:**
- [ ] Review and merge `pin_label_fix.patch` separately.
- [ ] Run the BLOCKED Teams/OTJH DB suites on an empty Postgres test database.
- [ ] Click through the curriculum coverage, learner dashboard, caseload and review form screens on the rehearsal branch.

## 10. Production runbook (when GO)

1. **Restore point:** Neon snapshot or branch of Production immediately before step 4. Record its id.
2. **Plan:** run `01_plan.sql`. Compare the counts with section 7 (live drift of a few rows is expected; anything structural means stop).
3. **Pre-checks:**
   - `08_verify_protected.sql` and `09_verify_touched.sql`: keep the output.
   - `05_reconcile.sql` (a).
4. **Apply:** `02_apply.sql`. It will be **attempt 2**, and it aborts on a stale plan or any reconciliation difference.
5. **Verify the apply:**
   - `05_reconcile.sql` (a)(b)(c).
   - `08_verify_protected.sql`: **must equal step 3 row for row**.
6. **Restart:** `systemctl restart 'lms-*.service'` (per-process caches).
7. **Part B, if approved:** `04_pin_remediation_plan.sql` with `SET ksb_pin_fix.confirm = 'yes'`. Expect 55 (or fewer if pins changed).
8. **Spot-check:** canonical KSB % for a few ME and MM learners, the programme page, a review form with a signed Skills Radar.

**Rollback, in this order:**
1. Part B: `04b_pin_remediation_rollback.sql` (the other session's; validate first) or the documented statement in `04`.
2. `03_rollback.sql`. It refuses while Part B is still applied, and aborts on conflicting later edits unless `ksb_mig.rollback_skip_conflicts = on`.
3. `09_verify_touched.sql` and `08_verify_protected.sql`: must equal step 3.
4. Restart the services.

**Last resort:** restore the step-1 snapshot.

## 11. Verified vs not verified

**Verified:**
- SQL apply, idempotency, rollback and ordering on a fresh copy of Production.
- The protected records listed in section 6.
- Per-learner figures through the application's own code, before and after.
- Old vs new code on unmigrated data: identical.
- The test results in section 8.
- The pin root-cause mechanism for v14 and the 11 Sep pins.
- Production's apply/rollback footprint.

**Not verified:**
- Why the label resolved to ST0845 (pre-16 Sep history missing).
- The deployed revision on the server.
- The Teams/OTJH DB suites that are BLOCKED.
- UI click-through.
- The other session's `04b`, `07` and `07b`.
- Whether `learner_activity_revisions` rows are shown to learners anywhere. The 1,186 Production rows, and the 593 the real apply will add, could appear in an activity history.

## 12. Environment left behind

| Neon branch (project `green-term-97168878`) | Purpose | State |
|---|---|---|
| `ksb-standards-migration-rehearsal-20261014` (`br-shy-river-abs49uyi`) | Fresh rehearsal, application checks | Migrated + Part B (attempt 3) |
| `ksb-standards-migration-before-20261014` (`br-long-darkness-abo3t1eh`) | Unmigrated copy for "before" figures | Untouched except application reads |
| `ksb-standards-migration-dryrun-20261014` (`br-quiet-dust-abgfe0mb`) | Scratch; ran the DB test suites | Scratch |
| `ksb-standards-migration-final-test-20261014` (`br-withered-rice-ab6x2kkc`) | Previous final test | Migrated |

Delete them when no longer needed.

Evidence files, scripts and logs are in `D:\ksb_val\` (outside the repository; internal learner ids only, no names).
