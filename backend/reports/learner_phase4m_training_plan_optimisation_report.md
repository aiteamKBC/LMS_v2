# Phase 4M — Learner Training Plan and Component Details Performance Optimisation

Date: 2026-10-28 (Africa/Cairo)  
Branch/workspace: current `fix/api-endpoints` checkout  
Measurement boundary: isolated Django/service read, not HTTP, middleware or browser

## 1. Verdict

**PARTIALLY OPTIMISED.**

The initial Training Plan overview now reuses the canonical, already-validated
Learner identity instead of reading and hydrating the same Learner profile a
second time. The deterministic result is **10 → 9 SQL queries (-10%)** with
exact response parity. Both independent 20-sample runs improved p95 and Python
time, but remote end-to-end medians were noisy and disagreed on wall/DB median
direction. The retained Reader fixture has 357 progress records but an empty
Training Plan, so rich module/week/component latency is not claimed as verified.

## 2. Selected Request and Evidence

Selected request:

`GET /learner_api/training-plan-dashboard/{kind}/{id}/?section=overview`

- Frontend consumers: `overviewSchedule` in `frontend/src/api/learnerOverview.ts`,
  `fetchTrainingPlanDashboard` in `frontend/src/api/trainingPlanDashboard.ts`,
  and `useDashboardPlan` in the Learner workspace.
- Backend entry point: `learner_api.training_plan_dashboard.training_plan_dashboard`.
- Main database work: enrolment source, canonical identity, canonical progress
  records/targets, plan/module projection, reviews/coach data, and—before this
  phase—a second Learner profile lookup.
- The request is read-only (`@require_GET`), has no database writes and has no
  external integration side effects.

The Phase 4K matrix left initial Training Plan loading at P1. Current tracing
found that the view already obtains canonical identity, but `read_dashboard`
then repeated the Learner profile lookup to obtain fields already present or
safely projectable from that identity. A rough pre-change service trace showed
10 queries for Overview; the duplicate profile SELECT alone added one remote
round trip and one model hydration.

Other candidates were not selected:

- Dashboard Training/module detail had a larger rough empty-fixture request,
  but the retained fixture has no selected module, so rich-detail improvement
  could not be demonstrated safely.
- Upcoming was event-empty and depends on broader date/review data.
- Component detail (`learner-detail?...component_id=...`) already received the
  Phase 4H projection optimisation and remains unverified end-to-end on a rich
  Reader fixture.

## 3. Request Execution Path

```text
Learner Dashboard / Training Plan
  → useDashboardPlan
  → overviewSchedule.read
  → GET /learner_api/training-plan-dashboard/{kind}/{id}/?section=overview
  → training_plan_dashboard
  → source_for_case_file or scoped enrolment source
  → canonical_learning.require_profile
  → read_dashboard
  → canonical progress/targets + plan/modules/reviews/coach
  → JsonResponse (private, no-store)
```

Module navigation uses the separate
`dashboard_training.read_module_request` path. It shares the same canonical
identity/profile reuse when a module is opened; its selected-module payload and
selection logic were not changed.

Frontend reads remain concurrent through `useLiveLearnerRead`; no request was
made eager, removed, resequenced or given a new cache policy.

## 4. Baseline

The safe benchmark used:

- Neon branch `lms_ideal_test`, ID `br-orange-shadow-abm8uwwe`;
- database `neondb`;
- Reader role `lms_benchmark_reader`;
- `transaction_read_only=on`;
- preserved synthetic enrolment ID 1602;
- 357 live progress rows;
- 20 alternating before/after samples per independent run;
- the same connection, fixture, parameters, service function and cache state.

Baseline shape: 10 SQL queries, 320 response bytes, no modules, sessions or
reviews. The fixture's empty Training Plan limits conclusions about rich plan
materialisation. The optional subject-attempt relation was unavailable to the
Reader and the KSB exclusion expression was held to the same `TRUE` predicate
in both variants.

## 5. Root Cause

`training_plan_dashboard` already validates and loads a canonical owner for the
enrolment. `read_dashboard` and module detail then performed another
`LearnerProfile.objects.filter(enrolment_id=...).only(...).first()` call for
profile, programme, cohort/group and coach fields.

This was not an N+1 across modules; it was one redundant identity/profile query
per request. It added a remote database round trip and hydrated a model from a
row whose ownership had already been validated. The dominant canonical
progress query remains the larger cost and was deliberately left unchanged to
preserve historical, soft-delete and progress-transfer semantics.

## 6. Exact Code Changes

- `backend/learner_api/selectors/identity.py` and `backend/login/selectors.py`
  add only the six missing Training Plan profile columns to the existing
  canonical identity projection: lifecycle/programme status, cohort/cohort ID,
  and group name/group ID.
- `backend/learner_api/training_plan_dashboard.py` adds `profile_from_owner`.
  It creates an unsaved `LearnerProfile` from the complete validated projection;
  incomplete legacy adapters/mocks return `None` and retain the original ORM
  fallback. Overview and Upcoming use this helper.
- `backend/learner_api/dashboard_training.py` applies the same reuse to module
  detail while retaining the existing profile/enrolment equality checks.
- Focused tests assert exact field reconstruction, no duplicate ORM call,
  incomplete-projection fallback, module endpoint ownership, and the intentional
  SQL projection delta.
- `backend/reports/benchmark_learner_training_plan_phase4m.py` provides the
  pinned, Reader-only, 20-sample before/after harness.

No frontend, model, schema, migration, data or API contract was changed.

## 7. Response and Business Logic Parity

The benchmark compared complete payloads on every warm-up and measured sample.
Parity passed after excluding only the existing volatile `generatedAt` value.
All other JSON keys, types, nulls, numeric values, ordering and response bytes
were exact.

The implementation does not alter:

- module/week/component selection, ordering or relationships;
- Training Plan totals, dates, time zones or coach selection;
- historical or duplicate progress handling;
- soft-delete or progress-transfer rules;
- anonymous/cross-Learner authorization, identity equality checks, status codes
  or messages;
- writes, external integrations, loading/error states or accessibility behavior.

The constructed model is unsaved and is used only as the same read projection
that the former ORM query returned. Incomplete owners use the old query.

## 8. Before/After Measurements

Two independent runs are reported because the remote canonical progress query
showed substantial latency variance. Both runs used 20 alternating samples per
variant and the same pinned Reader target.

| Metric | Run A Before | Run A After | Run A change | Run B Before | Run B After | Run B change |
|---|---:|---:|---:|---:|---:|---:|
| SQL query count | 10 | 9 | **-1 (-10%)** | 10 | 9 | **-1 (-10%)** |
| Wall median (ms) | 981.859 | 918.106 | -63.753 (-6.5%) | 1319.141 | 1377.350 | +58.209 (+4.4%) |
| Wall p95 (ms) | 2149.894 | 1905.918 | -243.976 (-11.3%) | 2500.782 | 2183.553 | -317.229 (-12.7%) |
| DB/client median (ms) | 910.497 | 852.710 | -57.787 (-6.3%) | 1255.718 | 1310.057 | +54.339 (+4.3%) |
| Python median (ms) | 67.135 | 64.870 | -2.265 (-3.4%) | 67.751 | 65.102 | -2.649 (-3.9%) |
| Process CPU median (ms) | 109.375 | 109.375 | unchanged | 109.375 | 109.375 | unchanged |
| Serialization median (ms) | 0.069 | 0.070 | +0.001 | 0.068 | 0.069 | +0.001 |
| Response bytes | 320 | 320 | unchanged | 320 | 320 | unchanged |
| Peak allocated bytes | 5,121,470 | 5,120,487 | -983 | 5,120,552 | 5,120,055 | -497 |

The removed profile SELECT's latest server plan was 0.101 ms planning and
0.048 ms execution; its practical value is avoiding a whole remote query and
model hydration. Query count, response size and parity are deterministic.
Median wall/DB latency is inconclusive across repeats, while p95 and Python time
improved in both. Therefore this report does not claim an HTTP improvement or a
stable median latency percentage.

## 9. Backend Tests

Final focused and regression results:

- Phase 4M identity/module/profile suites: **PASS — 82/82**.
- Home compact sections and dashboard tabs: **PASS — 48/48**.
- Phase 4J Header/Weekly regression: **PASS — 47/47**.
- Phase 4K Metrics regression: **PASS — 34/34**.
- Phase 4L Weekly Learner/Coach regression: **PASS — 61/61**.
- Reader benchmark: **PASS**, twice; 20 alternating samples per variant per
  run, exact parity, zero errors and zero timeouts.

The focused tests cover complete/incomplete canonical projections, both Learner
kinds, empty and large synthetic module shapes, module selection and ordering,
missing metadata, legacy fallbacks, errors, POST denial, identity ownership,
progress-transfer metrics and no additional query on the optimised path.

The full `learner_api.tests_training_plan_dashboard` module ran **45 passed,
1 failed, 1 error**. The two non-passing cases are existing unrelated test
maintenance issues described in section 12; all Phase 4M tests in that module
passed.

No database write, migration, fixture cleanup or external call was used.

## 10. Frontend Tests

```text
npm --prefix frontend run test --
  src/pages/workspace/learner/__tests__/DashboardTrainingPlan.test.tsx
  src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx
  src/api/__tests__/learnerOverview.test.ts
  src/api/__tests__/dashboardTraining.test.ts --maxWorkers=2
```

**PASS — 50/50 across 4 files.** The tests verify Training Plan rendering,
module navigation/request graph, lazy behavior, loading/error behavior and API
client contracts. No frontend source changed, and no additional request was
introduced.

The known `learnerContentLoading` suite was reproduced separately: **2 passed,
5 failed**, matching the documented pre-Phase 4M baseline. TypeScript was not
rerun because no frontend source changed and the project records that broader
check as previously blocked/timed out.

## 11. Coach Regression Results

The canonical identity projection is shared, so the relevant Coach case-file
overview, module selection and learning-plan projection suites were run:

- `coach_api.tests_case_file_overview`
- `coach_api.tests_overview_modules`
- `coach_api.tests_overview_module_selection`
- `coach_api.tests_learning_plan_projection`

**PASS — 41/41.** Phase 4L's Coach/Learner Weekly group also passed as part of
the 61/61 regression result.

## 12. Existing Unrelated Failures

- `test_overview_exposes_review_form_links_from_learner_calendar` patches a
  removed `training_plan_dashboard.stored_training_plan` symbol before the test
  reaches the Phase 4M path.
- `test_overview_reads_current_calendar_targets_and_stored_booking_changes`
  expects one current calendar target but receives zero under the current
  date-sensitive fixture. Its source has no complete canonical owner, so Phase
  4M takes the unchanged ORM fallback.
- `learnerContentLoading`: four fixtures fail the existing activity identity
  guard and one fixture supplies invalid JSON; 5 failed / 2 passed exactly as
  previously documented.
- Earlier exploratory broad runs also encountered existing tests coupled to
  removed `_preset_ids_for`, old Phase 4K metrics calls/SQL, a dynamic loader
  missing `_profile_matches_canonical_identity`, and an unprovisioned SQLite
  login schema. None was modified or suppressed.

## 13. Remaining Bottlenecks

- The canonical progress projection remains the dominant query and varies
  substantially on the remote Reader connection.
- The preserved Reader fixture has no Training Plan modules, sessions or
  reviews, so rich tree construction, selected module/week detail and component
  navigation still lack representative end-to-end timing.
- Module detail still has broader current/historical progress and metadata
  work. A possible duplicate progress read was inspected but not changed because
  materialising it safely would need stronger soft-delete/progress-transfer
  fixtures.
- Component detail retains the Phase 4H projection improvement but still needs
  a rich, Reader-accessible end-to-end fixture.

## 14. Recommended Phase 4N Target

Create or identify a preserved, read-only benchmark fixture with a non-empty
Training Plan containing multiple modules, weeks and component types, including
historical/duplicate/deleted/transferred progress. Then profile the selected
module request and component detail end-to-end. The first candidate should be
the repeated current/historical progress materialisation in module detail, but
only if exact soft-delete and progress-transfer parity can be demonstrated.

## 15. Safety Confirmation

- No Production or `lms-ideal-architecture` access.
- No Neon reset and no owner credentials.
- Pinned `lms_ideal_test` Reader identity and read-only transaction verified.
- No schema, migration, data, fixture, learner-record or environment change.
- No external integration or live Teams operation.
- No Teams trigger file edited; Teams baseline and expanded Teams checks are
  **NOT REQUIRED**.
- No UI/UX, API contract, business formula, permission, soft-delete or
  progress-transfer behavior changed.
- Existing staged, unstaged and unrelated contributor changes were preserved.
- No branch/worktree creation or switch, no commit and no push.
- No HTTP improvement is claimed.
