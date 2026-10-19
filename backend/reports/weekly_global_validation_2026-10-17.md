# Global Weekly Learning validation on coach_view

Continued the existing uncommitted implementation after the owner confirmed the
other agent had finished. All work remains on `coach_view`; no branch switch,
commit, push, PR, merge, deployment, schema/data write or live Microsoft action.
The existing calendar JSON normalization fix is retained.

## Scope and changes in this pass

The existing shared Student Weekly reader uses the Coach canonical reader with
request-local routing metadata, narrowed ledger reads, a per-component hours
index, compact V2 responses and reusable frontend request/cache functions. No
learner-specific condition was found in the inspected Weekly reader, calendar,
adapter, hook or panel. Those runtime files were preserved in this pass.

Extended `learner_api/test_weekly_optimization_no_db.py` with a matrix comparing
optimized hours against the canonical projection for Commercial/Apprenticeship
and Legacy/Native records, including retries, multiple modules and staff-marked
assignment hours. Native direct saves have a null source_system. Extended
`weeklyLearningContract.test.ts` with learner-type, learner and module cache
isolation checks while retaining canonical fractional hours.

Added `scripts/benchmark_weekly_representative.py`. It discovers samples by
learner type and active old_lms progress lineage, and discovers weeks from actual
assigned navigation. It rotates module/slot-kind groups without fixed learner,
module, programme or week selection. All database aliases receive PostgreSQL
read-only startup options; default/enrolment targets are verified privately.
External HTTP is forbidden and caches are process-local. Reports contain sample
ordinals, aggregate metrics and hashes, without IDs, learner content or SQL.
Historical two-example scripts/reports remain preserved; use this new benchmark
for representative validation.

## Current projection measurements

Command, from backend:

```powershell
.\.venv\Scripts\python.exe scripts/benchmark_weekly_representative.py --output reports/weekly_representative_2026-10-17.json --runs 2 --samples-per-stratum 2 --weeks-per-learner 3
```

32 successful reads: four Commercial learners, two per lineage, navigation and
three discovered detail selections each, two runs. No projection errors.

| Lineage | Navigation median | Detail median | SQL calls/read |
| --- | ---: | ---: | ---: |
| Legacy | 3156.14 ms | 1932.59 ms | 13–14 |
| Native | 1677.49 ms | 1188.85 ms | 12–14 |

Apprenticeship Legacy and Native live timing: **NOT VERIFIED**, no eligible active
sample with canonical training-plan membership was found. Native sampling means
no active old_lms progress, and may include learners without progress. Results
exclude HTTP/authentication/browser rendering and do not demonstrate a controlled
before/after speedup. They cannot prove every programme/module/week or edge case.
An initial attempt to open unrelated audit aliases failed with OperationalError;
the final runner opens only needed aliases upfront, retaining read-only options
for every alias. No credentials or driver connection details were printed.

## Checks

- Backend feature checks: **PASS, 76 tests**. Used unittest directly after replacing
  every configured database engine with `django.db.backends.dummy` before Django
  setup, process-local cache and argv `test` to prevent curriculum warming. No
  Django database-provisioning runner was invoked. Suites:
  `learner_api.test_weekly_optimization_no_db`,
  `learner_api.test_weekly_json_null_no_db`,
  `learner_api.test_dashboard_weekly_no_db` (33 tests),
  `coach_api.tests_weekly_learning`, `learner_api.test_dashboard_header_no_db`,
  `learner_api.test_header_deadlines_no_db` (43 tests).
  The final 33-test group was rerun after correcting Native fixture lineage.
- Frontend feature checks: **PASS, 106 tests**. From frontend:

```powershell
npx vitest run src/api/__tests__/weeklyLearningContract.test.ts src/hooks/__tests__/useWeeklyLearning.test.tsx src/hooks/__tests__/useWeeklyLearningWeek.test.tsx --maxWorkers=2
npx vitest run src/pages/workspace/learner/__tests__/WeeklyLearningPlan.test.tsx src/pages/workspace/learner/__tests__/DashboardWeeklyLearningPlan.test.tsx src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx src/api/__tests__/weeklyMutations.test.ts src/api/__tests__/weeklyLearningDiagnostics.test.ts src/lib/__tests__/curriculumApi.crossTab.test.ts --maxWorkers=2
```

  Respectively 40 and 66 tests. An earlier invocation from repository root failed
  alias resolution before running tests; corrected by running in frontend.
- Teams baseline: **PASS, 119 tests / nine files**,
  `npm --prefix frontend run test:teams`. Required because the inherited change
  set includes `frontend/src/lib/curriculumApi.ts`; no Teams file changed afterward.
- Expanded Teams database checks: **BLOCKED**. No verified non-production database
  for the required curriculum/coach/learner integration suites. Mocked feature
  tests and read-only live benchmarks do not replace those suites.
- `npm --prefix frontend run type-check`: **PASS**.
- `npm --prefix frontend run build`: **PASS**, 4127 transformed modules;
  plugin timing advisory. Build artifacts are not staged.
- `npm --prefix frontend run lint`: **FAIL**, 32 errors / 139 warnings. No claim
  that these are pre-existing; no clean before baseline was run.
- From frontend, `npx eslint src/api/__tests__/weeklyLearningContract.test.ts --report-unused-disable-directives --max-warnings 0`: **PASS**.
- `git diff --check`: **PASS**.

Existing and extended tests cover calendar null normalization and strict invalid
schedule errors, bank/college holiday overlap and exclusions, module/session
overrides, reading weeks, attendance states, selected activity routing, historical
quiz ambiguity, dedupe and cache races. These are automated cases, not exhaustive
live validation of those rules for all learners.

Live Teams: **NOT RUN**. Browser interaction: **NOT RUN**, no verified isolated
application database. Acceptance remains pending lint resolution/review, expanded
Teams checks and unavailable Apprenticeship live benchmark coverage. No release
readiness or universal performance improvement is claimed.
