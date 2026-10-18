# Student Dashboard consolidation on coach_view

All implementation remains local and uncommitted on `coach_view`. No pull, merge,
rebase, cherry-pick, reset, new branch, deployment, migration, index creation or
database write was performed. Existing work was inventoried and hashed before edits.
Git state does not prove whether another agent is actively editing a worktree.

## Source reconciliation

- `LMS_v2_header` / `perf/student-header-v2-current-20261017`: Header V2, scheduling,
  profile validation, compact React rendering, request caching and regression tests
  were already transferred. Implementation files matched at task start. Shared page
  tests and the audit report on coach_view have later additions, retained here.
- `LMS_v2-weekly-perf` / `perf/weekly-learning-20261017`: SQL/ledger improvements,
  selected-activity routing, compact V2, mutation invalidation, attendance states,
  holiday/reading-week handling and tests are already present. Coach_view's newer
  request diagnostics and StrictMode/cache tests are retained. Different historical
  course-qualified identity helpers in canonical_learning were not copied over
  coach_view: they are not the Weekly performance patch and affect calculations.
- `LMS_v2-learner-home-push` / `codex/learner-home-performance`: Home projection,
  Continue Learning and initial-tab work is present or superseded by newer dashboard
  endpoints. Compared commit b305d77f and relevant current functions; retained newer
  compact review booking and tab snapshot support. No entire file was copied.
- `LMS_v2-profile` / `perf/learner-dashboard-profile`: old profile URL integration is
  superseded by Header V2/summary reads. Its uncommitted dashboardProfile test targets
  the obsolete profile endpoint and was not transferred.
- `LMS_v2-attendance-route` / `fix/learner-attendance-route`: committed work is already
  an ancestor of coach_view.
- `LMS_v2-profile-baseline`, `LMS_v2_header_baseline`,
  `LMS_v2_coach_header_baseline`: comparison baselines, not missing implementations.
  `LMS_v2_header_current_baseline` contains the current pre-optimization Header
  snapshot used in this paired benchmark. No development occurred there.

No missing safe Header/Weekly implementation needed copying in this pass. The
previous app-wide cache-epoch polling removal remains intact; no remote polling or
parallel cache was introduced.

## New optimizations and integration fixes

- Header enrolment reads now project only moduleId/assignmentMode from stored plan
  arrays in PostgreSQL. Array order, non-object placeholders, non-array values,
  null/empty semantics and Training_plan/Learning_plan fallback remain preserved.
  The canonical module assignment, permissions and deadline scheduler are unchanged.
  Both legacy and V2 response builders use the same narrow read.
- React explicitly checks version 2 before consuming a Header response and refuses
  a legacy response; cache peeks also reject a mismatched contract. Existing learner,
  account and contract-version cache isolation remains in the existing request layer.
- Request-graph mocks match Weekly endpoint pathname independently of query strings;
  exact request assertions include version=2. No assertions were removed.
- The benchmark supports current V2 baselines, the narrow source reader, Weekly
  measurements and privacy-filtered read-only EXPLAIN ANALYZE.

No additional response fields were removed in this pass. UI markup, formatting,
OTJH/KSB/completion/attendance rules and Coach API contracts were not changed.

## Measurements

`header_consolidated_performance_2026-10-17.json`: same two commercial learners,
three runs each, alternating paired variants, all aliases configured read-only,
external HTTP forbidden, process-local cache, HTTP/authentication excluded.
The current pre-change Header snapshot uses current shared helpers, unchanged here.
All twelve legacy payloads match byte for byte within each pair.

| Metric | Earlier reported baseline | Paired current baseline | Optimized |
|---|---:|---:|---:|
| Median backend projection | 3.25s | 2.587s | 1.901s |
| Median database-call time | 3.16s | 2.477s | 1.836s |
| Warm SQL count | 21 | 21 | 21 |
| Header raw bytes, samples 1 / 2 | — | 3941 / 4671 | 3941 / 4671 |
| Header gzip bytes, samples 1 / 2 | — | 1232 / 1542 | 1232 / 1542 |
| Initial Header requests, network-mocked tests | 1 | 1 | 1 |
| Authenticated HTTP / React render duration | Unverified | Unverified | Unverified |

Paired median projection reduction is 26.5%; database-call time reduction is 25.9%.
Do not compare separate sessions as a controlled speedup: network latency varied
substantially in subsequent runs. Query count reduction is not claimed.
The source read averaged 906.77ms before and 79.42ms after in this paired run.
Stored plan text sizes were 751155 and 1035053 bytes. Read-only EXPLAIN ANALYZE
uses Created_users_pkey, one result row, server execution 1.882ms / 3.730ms.
No missing enrolment lookup index was demonstrated.

Top five optimized Header SQL operations by total call time across six reads:

| Operation / responsible path | Total | Mean per call |
|---|---:|---:|
| Assignment components / upcoming_assignment_deadlines | 1073.27ms | 178.88ms |
| Coach calendar event projection / plan_reviews | 823.85ms | 137.31ms |
| England holidays / canonical Builder scheduling | 777.48ms | 129.58ms |
| Cohort metadata / Builder activity-date resolution | 511.21ms | 170.40ms (3 calls) |
| Curriculum membership / canonical_learning.curriculum_module_ids_for | 493.53ms | 82.25ms |

The separate Weekly benchmark is in `weekly_consolidated_performance_2026-10-17.json`.
One learner fails all three attempts because canonical normalise_weekly_schedule
rejects a stored value at the list/maximum-seven-days validation. No fallback, data
repair or permission bypass was added. The second learner's three successful reads
have median 6.227s projection, 5.805s database-call time, 16 queries, 49143 raw bytes,
4723 gzip bytes. There is no comparable live Weekly before baseline, so no Weekly
speedup is claimed. Its largest calls are progress ledger, selected components,
progress routing and full profile resolution (roughly 1.2–1.3s each in this run).
Header and Weekly still independently read identity, membership and scheduling data;
cross-request caching/reuse was not added without an invalidation design.

## Validation and limitations

- Backend direct unittest runner with settings_sqlite_test, LocMem cache and no test
  database setup: **165 PASS**. Suites: test_dashboard_header_no_db,
  test_header_deadlines_no_db, test_weekly_optimization_no_db,
  test_dashboard_weekly_no_db, coach_api.tests_weekly_learning, tests_weekly_hours,
  tests_weekly_learning, test_canonical_learning_no_db, tests_holiday_reading_weeks.
- Frontend local Vitest: **179 PASS across 18 suites**, including Header transport,
  Header hook/cards, Weekly API/hooks/plan/tabs, reflection submission, absence reads,
  mutation invalidation, request cache, Coach Weekly and full dashboard request graph.
  Request graph alone: **19 PASS**, including learner switching, gates, actions and
  exactly one initial Header request. Header V2 opt-in is asserted at fetch boundary.
- `npm --prefix frontend run build`: **PASS**, 29.87s after restoring qrcode.react.
- `npm --prefix frontend run type-check`: **PASS**, including the final rerun.
- `npm --prefix frontend run lint`: **FAIL**, 32 errors / 139 warnings, matching the
  recorded earlier baseline. No broad cleanup was attempted.
- `git diff --check`: **PASS**.
- Teams baseline / expanded Teams: **NOT REQUIRED for new edits in this pass**;
  none of these edits changes a listed Teams file or its consumed contract.
  Prior polling-removal validation remains documented separately (119 frontend,
  14 pure backend passes). Live Teams: **NOT RUN**.
- Browser screenshots, authenticated HTTP and actual React profiler durations:
  **NOT RUN**. Production HTTP could invoke middleware/external side effects;
  no safe authenticated browser environment was established under the no-write rule.
- Full DB-mutating integration suites: **NOT RUN**, prohibited by task restrictions.

qrcode.react was already declared and locked at 4.2.0, but absent from the shared
node_modules tree (the isolated Header checkout points to that same installed tree).
Restored only that package from the registry tarball after SHA512 verification against
package-lock, with no install scripts and no package.json/lock changes. An earlier
build started before restoration failed on that missing import; the later build passed.

Consolidation implementation is present and focused checks pass, but full acceptance
remains limited by the live Weekly schedule error, repository lint failures and missing
authenticated browser/HTTP timings. No claim of fully validated live workflows is made.

Exact files changed in this pass and the full inherited pending-file inventory are
listed in `coach_view_consolidation_files_2026-10-17.json`. The six existing files
changed here are dashboard_header.py, test_dashboard_header_no_db.py,
benchmark_dashboard_header.py, dashboardHeader.ts, dashboardHeader.test.ts and
dashboardRequestGraph.test.tsx. All other 44 inventoried pending files retain their
starting SHA256 hashes. Reports are new files. Installed node_modules is ignored.
