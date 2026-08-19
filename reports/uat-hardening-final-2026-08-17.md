# Final Pre-UAT Hardening — 2026-08-17

Live database: Neon PostgreSQL 18.4 (`neondb`, endpoint `ep-wild-shape-ab005yy6`).
Follows `reports/uat-hardening-2026-08-17.md`; nothing in that report was reopened.

## 1. Failed / incomplete activity cannot count as achieved KSB progress

The completion model was already in the data — `learner_progress_entries.passed`,
a nullable boolean — but only one reporting site referenced it, and only for
`kind = 'quiz'`. It was safe purely because no failed row happened to carry
Component lineage.

`learner_api/progress_rules.py` now states the rule once:

* `passed IS FALSE` never counts, whatever the kind;
* a graded kind (`quiz`) needs an explicit `passed IS TRUE`;
* every other kind records a completion, so `passed` stays NULL and the row is
  the achievement.

Deliberately Python-only: every reader already selects `kind`/`passed` and
aggregates in Python, so a SQL twin would only be a second implementation to
drift. Pinned by a test.

Applied at:

| Surface | Before | After |
|---|---|---|
| `curriculum_api.views.learner_progress_ksb_consumption` | ungated | gated; excluded rows returned under `consumptionSources.excludedProgress` |
| `curriculum_api.views.reflection_submission_ksb_consumption` | ungated | gated via the reflection's `progress_entry_id` |
| `coach_api.views.completed_ksb_codes` | quiz-only | all kinds |
| `coach_api.views.build_ksb_completed_details` | quiz-only, activity feed ungated | all kinds, both sources |
| `frontend .../learnerJourney.ts` `recordedKsbEvidenceCodes` | quiz-only | all kinds |
| `frontend .../learnerJourney.ts` `completedComponentIds` | ungated | gated |

The activity itself is never hidden or deleted.

## 2. New writes cannot target soft-deleted components

`component_reference_exists()` stays the **historical** resolver — soft-deleted
components must keep resolving, or historical progress stops joining to
curriculum. `component_reference_state()` is the new **write-side** gate. It
mirrors the `is_deleted` expression of `curriculum.component_learning_lineage`
(migration 0041) across component → week → module → group → cohort → programme,
so parent-driven deletion is caught and named.

`save_progress_record()` rejects `unknown` → `OrphanComponentReferenceError` and
`deleted` → `DeletedComponentReferenceError`; both derive from
`ComponentReferenceError`, which the three write paths map to HTTP 400.

An unanswerable lookup re-raises rather than reporting "deleted", so a database
hiccup cannot reject valid learner work.

## 3. `repair_curriculum_parent_links` soft-delete defect

Parents and children were resolved by id alone, so a soft-deleted group id was
written back into a surviving cohort's `group_ids`, and deleted parents pushed
their lineage down onto surviving children.

Two rules now hold, expressed through `curriculum_row_effectively_deleted()`:

1. repair writes only to rows that are not effectively deleted;
2. what it writes never references an effectively deleted row.

Delete state is read-only to repair — no branch touches `deleted_at`,
`deleted_by` or `deleted_via_parent` — so a surviving child holding an old parent
id can never restore that parent. Restore stays explicit
(`restore_soft_delete_payload`). Also removed three dead statements that queried
modules/weeks and discarded the result.

## 4. Additional defect found by the required verification

The coach caseload returned HTTP 500 against the live schema:
`relation "Learner.learner_ksbs" does not exist`. `LearnerProfile.ksbs`
tolerates the dropped legacy snapshot table, but a queryset-level
`prefetch_related("assigned_ksbs")` raises first. Fixed with
`learner_ksbs_relation_exists()`, matching the existing probe used for the
retired activity-events relation. Without this, coach-side verification of the
fresh activity was impossible.

## Verification

* `manage.py check`: clean. `py_compile`: clean. `git diff --check`: clean.
* Backend, hardening scope (`learner_api curriculum_api coach_api quiz_api`):
  **233 passed** (was 183) — 50 new tests.
* Backend, full suite: **502 tests, 6 failures + 1 error**, all seven confirmed
  pre-existing at `HEAD` (`audit_api` planned/actual-hours + `config` endpoint
  smoke) by running them in a clean worktree at 518e754.
* PostgreSQL FK integrity: **12/12** on a throwaway PG 18.4 database, dropped
  afterwards.
* Frontend `npm run build`: exit 0. `vitest`: 285 tests, 281 passed, 4
  pre-existing failures in two `learner-log-pro-*/lib/lastAuditRequests.test.ts`
  files (they exercise `learner-log-pro-*/lib/api.ts`, untouched here).
* Fresh live end-to-end run through real HTTP endpoints: **89/89**, then fully
  removed. Progress rows 65 → 65, components 200 → 200, unexplained
  `component_link_status` = 0.

## Known gaps (pre-existing, not introduced here)

1. **Reflections never reach Curriculum impact.**
   `learning_reflection_submissions.learner_id` holds the *enrolment source* id
   (37/36/19 live) while `curriculum_programme_learner_ksb_impact` matches
   *learner profile* ids, and the table has no email column. So
   reflection-declared KSB weights and `actual_time_hours` never appear in that
   payload for any learner. Fixing it would start counting reflection weights
   toward achieved KSB totals — a change to reported numbers, so it needs an
   explicit decision rather than a silent fix. The reflection gate added in §1 is
   covered by unit tests.
2. **`npm run type-check` fails** on 9 files, including `KsbMapping.weightClass`
   being required while three authoring literals omit it
   (`module-builder/moduleAuthoringData.ts:526`,
   `week-builder/page.tsx:2184`). Pre-existing on this branch from the earlier
   component-KSB-weight work; `npm run build` is unaffected.

## Test data state

* **Kept** — `COMP-20260816E2E` (expected_otjh 3), progress 90 (learner 18) with
  K1 50/hard, S2 30/soft, B1 20/possible, and its reflection
  (`e0aa44ee`, planned 3 / actual 2.5). Verified intact after the run.
* **Removed** — everything stamped `UATE2E20260817B`, plus both throwaway
  Postgres databases used for the FK suite.
* **Left in place, classified** — reflections `30ee33bf` (source 36) and
  `7ebb7bff` (source 19), as before.
