# Weekly Learning week switching on coach_view

Local uncommitted work only. No branch creation, merge, deployment, database write,
migration or index creation. The previous agent's JSON-null normalization and its
regression suite remain intact. Shared backend edits were paused when ownership
was uncertain and resumed after the owner confirmed the previous task was complete.

## Request trace and root causes

Commercial enrolment 265, AI In Marketing, module
`MOD-20260921085217095815146F2085A499`:

```text
GET /learner_api/dashboard/commercial/265/weekly/slot%3AMOD-20260921085217095815146F2085A499%3A3/?moduleId=MOD-20260921085217095815146F2085A499&version=2
WeeklyLearningPlan -> useWeeklyLearningWeek -> fetchWeeklyLearningWeek
 -> existing weekResource -> readLearnerJson -> dashboard_weekly
 -> assignment_projection -> read_dashboard_weekly
 -> require_profile / learner_profile_for_source
 -> read_weekly_learning -> canonical scheduling / completion / attendance / hours
 -> _resolve_from_master -> compact_weekly
```

The 18-activity response was preceded by 247 module component rows, separate cohort
and two holiday reads, a full ORM learner-profile read, a separate fallback KSB read,
completion evidence, learner-wide canonical ledger evidence and Student routing.
Warm requests performed 17 SQL calls. The measured local baseline did not reproduce
the reported 4.91-second browser request: initial runs were about 1.7–2.1 seconds.
Subsequent paired runs varied considerably. Most measured request time was inside
database calls, which include network/driver wait and are not PostgreSQL execution
time alone. No authenticated browser/HTTP or pool-wait attribution was measured.

Read-only EXPLAIN found the hours query's correlated segment-presence test scanning
54925 reporting-segment rows. All 231 learner ledger records are still needed for
canonical native deduplication, accepted hours and unsynchronized direct saves;
the ledger was not arbitrarily filtered to the selected week. Completion retains its
separate evidence read: its historical/deletion semantics are not interchangeable
with the hours-only projection.

## Implemented changes

1. Student detail component reads now select the requested week plus module-wide
   quiz placements. Week 2 rows fell from 247 to 56; Week 3 from 247 to 57. Retaining
   other quiz placements preserves ambiguity for legacy quiz-only hour records.
   Initial navigation and Coach readers retain their existing component scope.
2. Weekly identity resolution uses the existing helper with an optional narrow
   field projection (id/enrolment_id). Both canonical ownership and identity checks
   remain, with healing disabled. Other callers retain the old default projection.
3. Cohort details, England holidays and authored holidays use one UNION ALL read.
   Existing archive filtering, sorting, exclusions and scheduling functions remain.
   Errors still propagate; there is no empty-calendar fallback or new cache.
4. Student fallback KSB codes are projected with selected activity details, removing
   another round trip. Coach fallback reads retain their old path.
5. The segment-presence subquery adds an explicit learner parameter equal to the
   already-scoped progress learner. It uses the existing
   learner_activity_reporting_segments_month_idx instead of scanning all segments.
   SQL row parity was checked before/after. Accepted hours, allocation, completion,
   attendance and KSB counting rules were not changed.
6. One next week is prefetched after a user-selected visible week settles and a
   750ms pause. No initial-load prefetch, recursion or all-week prefetch. The timer
   cancels on selection/unmount; background loading skips when another week-detail
   request is active. User reads share in-flight/cache entries. Background errors
   are traced and not cached; selecting that week retries normally.
7. Known reflection/component/video/quiz/quiz-reading mutations invalidate their
   activity and cached shared quiz placements, preserving independent cached weeks.
   Unknown mappings and pending details invalidate conservatively. Attendance and
   schedule changes retain broad invalidation because their cross-week effects are
   not reliably localized. Navigation summaries still refresh after mutations.

Existing immediate selection, per-identity stale-response protection, cached first
render and three-row loading skeleton were preserved. The previous week's activities
are hidden while an uncached week loads. No UI markup/design or endpoint changed.

## Measurements

Final artifact: `week_switch_final_paired_2026-10-17.json`.

Three Week 2 -> Week 3 -> Week 2 sequences, alternating baseline/current order,
18 total projection reads. The benchmark reconstructs only this task's changed
reader paths in memory: old component scope, full profile projection, separate
calendar/KSB reads and old segment predicate. Both variants retain the completed
JSON-null normalization fix. All aliases are PostgreSQL read-only, default/enrolment
sessions verified, external HTTP forbidden and cache process-local. Parameters,
learner names and payload content are not saved. Payload hashes match for both weeks
across every read. Timings include benchmark stack-inventory overhead but exclude
HTTP/authentication and browser rendering. Connections are already opened during
safety checks; this is not a cold connection/pool benchmark.

| Median metric | Baseline | Optimized |
|---|---:|---:|
| Overall projection, nine reads per variant | 2384.18ms | 2129.83ms |
| Overall database-call time | 2309.43ms | 2077.62ms |
| Warm SQL calls | 17 | 14 |
| Warm calls by alias: default / enrolment | 4 / 13 | 2 / 12 |
| Week 2 projection, six reads per variant | 2347.60ms | 1823.87ms |
| Week 2 database-call time | 2236.70ms | 1769.74ms |
| Week 3 projection, three reads per variant | 2447.06ms | 2691.45ms |
| Week 3 database-call time | 2375.29ms | 2634.62ms |
| Week 2 raw / gzip bytes | 7282 / 1483 | 7282 / 1483 |
| Week 3 raw / gzip bytes | 7609 / 1481 | 7609 / 1481 |
| Week 2 / Week 3 activities | 17 / 18 | 17 / 18 |
| Authenticated browser request duration | Unverified | Unverified |
| Browser React render duration | Unverified | Unverified |

Overall median reduction is 10.7%, but **Week 3 alone was not consistently faster**.
Do not claim this solves the reported 4.91-second browser delay or extrapolate these
small, variable samples into a guaranteed production improvement. Earlier intermediate
measurements are retained in week_switch_before, week_switch_after,
week_switch_after_final and week_switch_paired reports rather than being hidden.
The first baseline process request had an additional schema-discovery query (18);
the optimized variant in the paired process does not establish a comparable cold
discovery duration. No persistent backend response cache was introduced.

`week_switch_ledger_explain_paired_2026-10-17.json`: PostgreSQL server execution
26.202ms -> 7.218ms. Segment scan rows 54925 -> 0 for this learner (who has no
reporting segments); existing index used, ledger result remains 231 identical rows.
This is one paired EXPLAIN measurement, not an end-to-end HTTP speedup.

Top five optimized database operations across nine projection reads:

| Operation / function | Total client DB-call time | Mean |
|---|---:|---:|
| Calendar union / weekly_calendar.cohort_holidays | 2865.05ms | 318.34ms |
| Hours ledger / canonical_learning.weekly_hour_records | 2603.78ms | 289.31ms |
| Student routing / learner_detail._resolve_from_master | 1382.89ms | 153.65ms |
| Curriculum membership / canonical_learning.curriculum_module_ids_for | 1297.43ms | 144.16ms |
| Occurrence/attendance markers / read_weekly_learning | 1222.37ms | 135.82ms |

### Client switching evidence

Focused hook tests use the real custom cache and mocked network:

- Uncached Week 2 -> uncached Week 3 -> cached Week 2: two detail HTTP fetches;
  cached revisit is available synchronously, with no third request.
- With next-week prefetch: one visible Week 2 request, then one Week 3 prefetch
  only after visible completion and 750ms; selecting Week 3 and revisiting Week 2
  uses those cached snapshots, with no additional fetches.
- No prefetch starts while a visible request is active. No prefetch chain occurs.
- Navigation/unmount cancels the pending delay. Old selections/account-prefetch
  responses cannot restore invalidated data or overwrite the current selection.

These are reliably tested request counts and synchronous cache availability, not
invented browser millisecond measurements. A fast click before prefetch completes
still shows the lightweight loading state and shares the in-flight request.

## Regression and validation results

- **150 backend tests PASS**, direct unittest runner using settings_sqlite_test and
  LocMem cache, without test DB provisioning. Suites: test_weekly_optimization_no_db,
  test_dashboard_weekly_no_db, test_weekly_json_null_no_db, coach_api.tests_weekly_learning,
  tests_weekly_hours, tests_weekly_learning, test_canonical_learning_no_db,
  curriculum_api.tests_holiday_reading_weeks. Covers JSON null, strict invalid input,
  holiday exclusions/archive, reading/session overrides, identity denial, both learner
  types, canonical hours, legacy quiz ambiguity, KSB fallback and Coach compatibility.
- **182 frontend tests PASS across 15 suites**, local Vitest: useWeeklyLearningWeek,
  useWeeklyLearning, DashboardWeeklyLearningPlan, WeeklyLearningPlan, weeklyPlanHelpers,
  DashboardWeeklyTab, dashboardRequestGraph, weeklyMutations, weeklyLearningContract,
  reflectionSubmission, cachedRequest, learnerRead, quizzes, learnerContentLoading,
  caseFileWeeklyLearning. Includes scoped completion invalidation, account reset,
  cached switching, no duplicate requests, loading/error states and rapid switching.
- Read-only real-database view calls: learner profile 248 / enrolment 101 initial
  Weekly V2 **200**; enrolment 265 Week 2 **200**, Week 3 **200**. These invoke the view
  body and error mapping; they are not authenticated HTTP/browser tests.
- `npm --prefix frontend run type-check`: **PASS**, final source state.
- `npm --prefix frontend run build`: **PASS**, 25.45s, final production source state.
- Changed frontend files: local ESLint with --max-warnings 0 **PASS**.
- Full `npm --prefix frontend run lint`: **FAIL**, same 32 errors / 139 warnings as
  the recorded earlier baseline. No unrelated lint cleanup.
- `git diff --check`: **PASS**.
- Teams baseline / expanded Teams: **NOT REQUIRED**; no listed Teams file or its
  consumed changed function/type/response was edited. Live Teams: **NOT RUN**.
- Mutating backend integration tests: **NOT RUN**, prohibited by this task.

## Exact files changed in this task

Backend implementation/tests:

- backend/coach_api/weekly_learning.py
- backend/coach_api/tests_weekly_learning.py
- backend/learner_api/canonical_learning.py
- backend/learner_api/dashboard_weekly.py
- backend/learner_api/identity.py
- backend/learner_api/weekly_calendar.py
- backend/learner_api/test_dashboard_weekly_no_db.py
- backend/learner_api/test_weekly_optimization_no_db.py
- backend/scripts/benchmark_week_switch.py (new)

Frontend implementation/tests:

- frontend/src/api/weeklyLearning.ts
- frontend/src/api/learnerDetail.ts
- frontend/src/api/components.ts
- frontend/src/api/videos.ts
- frontend/src/api/quizzes.ts
- frontend/src/api/reflectionSubmission.ts
- frontend/src/api/__tests__/weeklyMutations.test.ts
- frontend/src/hooks/useWeeklyLearning.ts
- frontend/src/hooks/__tests__/useWeeklyLearningWeek.test.tsx
- frontend/src/pages/workspace/learner/WeeklyLearningPlan.tsx

New reports: this report; week_switch_before_2026-10-17.json,
week_switch_after_2026-10-17.json, week_switch_after_final_2026-10-17.json,
week_switch_paired_2026-10-17.json, week_switch_final_paired_2026-10-17.json,
week_switch_ledger_explain_2026-10-17.json,
week_switch_ledger_explain_paired_2026-10-17.json.

The previous agent's test_weekly_json_null_no_db.py and normalization are preserved;
they are not presented as newly authored here. Other pending dashboard work remains.

## Remaining limits

Uncached requests still make 14 remote SQL calls and retain the learner-wide ledger
facts needed for canonical deduplication. Network/driver variance remains significant.
Adjacent prefetch helps after its delay/completion, not during an immediate uncached
click. An authenticated browser trace with connection/pool and React profiler timing
is still needed to establish real UI latency and the source of the reported 4.91s.
No production-latency guarantee or complete resolution of uncached Week 3 is claimed.
