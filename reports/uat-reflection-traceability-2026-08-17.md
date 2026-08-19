# Reflection → Curriculum Impact Traceability — 2026-08-17

Live database: Neon PostgreSQL 18.4 (`neondb`, endpoint `ep-wild-shape-ab005yy6`).
Follows `reports/uat-hardening-final-2026-08-17.md`. Nothing in that report was
reopened; the three accepted hardening fixes are unchanged and re-verified.

## Root cause

`learning_reflection_submissions.learner_id` is a `varchar` holding the
**enrolment source** id (`enrolment."Created_users".id`). Curriculum impact
resolves learners from `"Learner"."learners"` — **profile** ids. Two id spaces,
and the reflection table has no email column at all:

| Table | Learner identifier for the same activity |
|---|---|
| `learner_progress_entries` | `learner_id = 18` (profile) |
| `learning_reflection_submissions` | `learner_id = '37'` (enrolment source) |
| `evidence_files` | `learner_id = '37'` (enrolment source) |

The old reader filtered `r.learner_id::text = any(profile_ids)`, which matched
nothing, for any learner, silently. Reflections never reached the payload.

## Fix

Resolution now goes through the deterministic link that already existed:

```
Learner → Progress → Component → Reflection
learning_reflection_submissions.progress_entry_id → learner_progress_entries.id
```

The progress row supplies the learner (`pe.learner_id`, a profile id) and the
component/module/week lineage. Both are immutable once written. Removed the
email branch (forbidden and dead against this schema); the submission's own
`learner_id` is reported for audit but never used to resolve.

A reflection whose progress row belongs to a different learner is **not**
attributed, even when its own `learner_id` matches — the ambiguity the old match
created is now closed by construction.

## KSB double-count protection

`learner_progress_ksbs` (the Component Progress snapshot) remains the sole source
of achieved weight. A reflection's declaration is supplementary evidence:

* `reflection_submission_ksb_consumption` returns **declared** totals, never
  merged into achieved;
* `learner_consumption_payload` exposes `consumedWeight` (progress) and
  `declaredReflectionWeight` (reflection) as separate fields;
* every reflection row carries `countsTowardAchievement: false` and
  `ksbRole: 'supplementary_evidence'`;
* `learnerActivities[].ksbSnapshot` and `.declaredReflectionKsbs` are separate
  lists;
* the frontend `learnerAchievementMap` no longer sums reflection rows into
  `weight` — this was a latent double-count that would have activated the moment
  the join started resolving;
* the payload states the rule in `ksbAchievementPolicy`.

Controlled activity: achieved 100, declared 100, reported total **100**, not 200.

## OTJH

Two fields, two named sources, never merged.

| Field | Source | Value |
|---|---|---|
| `expectedOtjh` | `learner_progress_entries` → `curriculum_component` | 3 |
| `actualOtjh` | `learning_reflection_submissions` | 2.5 |

`learner_progress_ksb_consumption` previously labelled expected OTJH
`curriculum_component` even when it came from the progress snapshot; it now
reports which one it actually was.

`apply_reflection_otjh_to_learners` no longer overwrites `completedHours` /
`plannedHours`. Those are programme-wide figures from `"Learner"."learners"`;
replacing them with a single reflection's subtotal would have under-reported
every learner with partial reflection coverage — a regression the fixed join
would have activated. Reflection OTJH is now its own field, and the canonical
value is only filled when absent.

## New payload

`learnerActivities` — one entry per Progress activity, keyed on
`learner_progress_entries.id`, carrying Component, Progress, expected OTJH,
Reflection, actual OTJH, Evidence, KSB snapshot and progress status. Evidence is
joined on `progress_entry_id` too, because `evidence_files.learner_id` has the
same source-id problem.

`consumptionSources.unlinkedLearningReflectionSubmissions` — reflections against
a component in the programme with no `progress_entry_id`. Not attributable
without guessing, so reported as a visible gap instead of vanishing.

## Verification

* Live impact endpoint, programme `PROG-20260708145303267692`: reflection
  `e0aa44ee` now resolves to learner 18 via progress 90.
* Cross-layer script, 39 checks, all pass: Curriculum / Learner / Coach agree on
  progress 90, `COMP-20260816E2E`, expected 3, actual 2.5, K1 50 hard / S2 30
  soft / B1 20 possible, 1 evidence file.
* Backend hardening scope: 255 tests, 1 error — `curriculum_api.tests`
  `test_tree_save_draft_programme_is_hidden_until_activated`, from in-flight
  draft-programme work that appeared mid-session; asserts a `programmes` key that
  `curriculum_collection_response` never returns. Not touched.
* Backend full suite: 524 tests, 6 failures + 2 errors = the 7 confirmed
  pre-existing baseline plus the one above.
* PostgreSQL FK integrity: 12/12 on a throwaway database, dropped after.
* `npm run type-check`: all curriculum/lib errors cleared, including every
  `weightClass` error. 21 remain in `src/features/audit/learner-log-pro-*`,
  byte-identical to HEAD and importing nothing changed here.
* `npm run build`: exit 0. `vitest`: 285 tests, 4 pre-existing failures.
* `manage.py check`, `py_compile`, `git diff --check`: clean.

## Out-of-scope defect fixed to unblock verification

`curriculum_api/migrations/0045_normalise_programme_archive_flags.py` (untracked,
appeared mid-session) queries `information_schema` with no vendor guard, which
crashed the entire SQLite test run before any test executed. Added the same
`vendor != 'postgresql'` guard every sibling migration (0040–0044) already has.
No effect on PostgreSQL.

## Data state

No writes. All verification was read-only (`GET` endpoints and `SELECT`).
Progress rows 65, reflections 3, evidence 21, unexplained `component_link_status`
0 — all unchanged. Component count moved 200 → 218 during the session from the
in-flight curriculum authoring work, not from here.
