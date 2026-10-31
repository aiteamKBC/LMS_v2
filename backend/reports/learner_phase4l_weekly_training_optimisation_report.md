# Phase 4L — Learner Weekly Learning and Training Plan Performance Optimisation

Date: 2026-10-28 (Africa/Cairo)

Branch/workspace: current `fix/api-endpoints` checkout. No branch, worktree,
commit or push was created.

## A. Verdict

**PARTIALLY OPTIMISED**.

The rich Weekly Learning path no longer loads the learner's persisted progress
twice.  The changed progress-hydration stage was verified on the preserved
357-row synthetic fixture with exact before/after parity and 20 alternating
samples:

- query count: **3 → 2**;
- median service-stage wall: **260.234 → 189.656 ms (-27.1%)**;
- p95 service-stage wall: **291.737 → 195.740 ms (-32.9%)**;
- DB-client execute median: **239.691 → 168.825 ms (-29.6%)**;
- internal result bytes: **292,523 → 292,523**, unchanged;
- errors/timeouts: **0 / 0**.

This is not classified as a complete endpoint optimisation claim because the
preserved synthetic fixture has progress history but an empty Weekly plan, and
the Reader cannot execute the rich plan's attendance relation.  The measured
boundary is the exact shared progress stage used by both Weekly initial and
detail requests, not HTTP, browser, middleware or full rich-response timing.

## B. Selected Request and Reason

Selected request family:

| Item | Selection |
|---|---|
| Page | Learner Dashboard / Weekly Learning |
| Initial URL | `GET /learner_api/dashboard/{kind}/{id}/weekly/plan/` |
| Detail URL | `GET /learner_api/dashboard/{kind}/{id}/weekly/plan/{weekId}/?moduleId={moduleId}` |
| Frontend | `frontend/src/api/weeklyLearning.ts`: `fetchWeeklyLearning` and `fetchWeeklyLearningWeek` |
| View | `learner_api.dashboard_weekly.dashboard_weekly` |
| Service | `coach_api.weekly_learning.read_weekly_learning` |
| Frequency | Initial request after the Dashboard Header; detail on learner selection or bounded adjacent prefetch |
| Side effects | Read-only; no write, refresh enqueue or external integration on this path |
| Previous coverage | Phase 4J removed one identity round trip; rich progress hydration remained duplicated |

Selection evidence:

1. Phase 4J measured the current empty-plan Weekly initial at seven queries and
   about 454 ms service median. A final-state rerun in Phase 4L again produced
   seven queries and 464.134 ms on that empty fixture.
2. Current source inspection showed that every rich selected-week response read
   progress once through the ORM for completion and again through
   `weekly_hour_records` for accepted hours.
3. The preserved synthetic fixture provides 357 progress rows and can safely
   reproduce the duplicated stage with the pinned Reader role.
4. The initial request is on the default Dashboard critical path and the same
   service powers lazy week detail, so one bounded fix benefits both paths.

Historical 6–9 second Weekly measurements were not used as the sole reason for
selection. They are older rich-projection evidence and are not current HTTP or
current full-service latency.

## C. Other High-Priority Candidates

| Rank | Candidate | Current evidence | Why not selected |
|---:|---|---|---|
| 1 | Minimal Dashboard Header | Final-state Reader run: eight queries, 553.473 ms service median, initial authorization gate | Already addressed in Phase 4J; Weekly had a newly verified duplicate progress read and is explicitly prioritised in 4L |
| 2 | Training Plan overview/upcoming | Initial Home/Dashboard consumers; broad modules, weeks, sessions, reviews and canonical progress path | No equivalent current safe baseline yet; selecting it would be assumption-led |
| 3 | Student Activity | Broad progress/history payload; Phase 4C related statement evidence | No current complete service/request measurement and a wider response-risk surface |

My Learning catalogue was not reopened: Phase 4E already reduced its dominant
canonical SQL, and no newer request-stage evidence displaced the three choices
above.

## D. Request Execution Map

```text
DashboardTabs / WeeklyLearningPlan
  -> fetchWeeklyLearning or fetchWeeklyLearningWeek
  -> GET /learner_api/dashboard/{kind}/{id}/weekly/plan[/weekId/]
  -> dashboard_weekly.dashboard_weekly
     -> assignment_projection(source)
     -> canonical_learning.require_profile
     -> read_dashboard_weekly
        -> coach_api.weekly_learning.read_weekly_learning
           -> effective assigned module IDs
           -> modules + authored weeks + curriculum slot spine
           -> component placement/content-presence projection
           -> live evidence and attendance markers
           -> weekly_hour_records (persisted progress + hour reconciliation)
           -> completion index from the same persisted population [Phase 4L]
           -> selected component/KSB/session details
           -> compact_weekly serializer
        -> learner action-routing enrichment
     -> JsonResponse + private,no-store
```

Frontend behavior remains:

- Header completes before the initial Weekly request.
- The initial response primes its selected-week detail cache.
- Adjacent detail prefetch remains delayed, bounded and non-duplicating.
- Overview, Monthly, Training and Rewards remain lazy.
- Cache keys remain scoped by learner kind, learner ID, module and week.

## E. Before Baseline

Two baselines are deliberately separated.

### Full empty-plan Weekly request component

Final-state Phase 4J harness rerun, 20 alternating iterations, Reader-only:

| Metric | Current empty-plan Weekly initial |
|---|---:|
| Queries | 7 |
| Service median | 464.134 ms |
| Service p95 | 1,248.716 ms |
| DB-client execute median | 456.994 ms |
| Python median | 7.105 ms |
| Serialized payload | 45 bytes |

This fixture returns before rich progress hydration, so Phase 4L correctly
leaves these seven queries and its response unchanged.

### Selected rich progress-hydration stage

Preserved synthetic fixture, 357 persisted progress rows:

| Metric | Before Phase 4L |
|---|---:|
| Queries | 3 |
| Median | 260.234 ms |
| p95 | 291.737 ms |
| DB-client execute median | 239.691 ms |
| Process CPU median | 15.625 ms |
| Completion rows | 357 |
| Internal serialized result | 292,523 bytes |
| Peak traced allocation | 1,189,502 bytes |
| Errors/timeouts | 0 / 0 |

The three measured stage queries were the canonical stored-progress hours read,
the optional-attempt relation check, and the separate ORM completion read. The
Reader cannot select optional subject attempts, so both variants consistently
treat that optional relation as absent inside the benchmark only.

Cache behavior was unchanged: no new cache was introduced and all calls used
the same connection, ordering and alternating warm sequence.

## F. Root Cause

For a selected non-empty week, `read_weekly_learning` performed two reads over
the same learner progress population:

1. an ORM query selecting `kind`, `component_ref`, `quiz_ref`, `passed` and
   `submitted_at`, filtered to selected components plus all quiz rows, to build
   completion status;
2. `canonical_learning.weekly_hour_records`, which later loaded all persisted
   learner progress with the same five fields plus the timing/lineage facts
   needed for accepted hours.

The canonical hours population already contained the exact persisted facts
used by the first query. The duplication cost one remote database round trip
and a second 357-row materialisation. PostgreSQL execution of the removed query
was only 0.391 ms; most measured cost was DB client/network/fetch wall, which is
why removing the round trip mattered more than changing its plan.

The duplicate could not be removed blindly for active progress transfers:
Weekly hours intentionally use frozen records while completion uses the live
progress relation. That split remains intact.

## G. Exact Code Changes

1. `backend/learner_api/canonical_learning.py`
   - `weekly_hour_records(..., include_stored=True)` can return both the final
     reconciled hour records and an exact five-field completion projection
     from its already-loaded persisted progress population;
   - the default return type and all existing callers remain unchanged;
   - the completion projection retains the legacy ORM order and soft-deleted
     history, while hours continue to exclude soft-deleted rows;
   - active progress transfers return `stored_progress=None`, explicitly
     preserving the old live-completion/frozen-hours behavior.
2. `backend/coach_api/weekly_learning.py`
   - adds `weekly_completion_records`, reproducing the former ORM filter and
     exact five-field projection in Python while preserving row order;
   - loads hour records at the former completion point and reuses their stored
     population;
   - retains the original ORM query only for active progress transfers;
   - removes the later duplicate call to `weekly_hour_records`.
3. Focused tests in:
   - `backend/coach_api/tests_weekly_learning.py`;
   - `backend/learner_api/test_weekly_optimization_no_db.py`.
4. Reproducible Reader-only harness:
   - `backend/reports/benchmark_learner_weekly_phase4l.py`.

No route, serializer, frontend file, cache key, schema, model, migration or
public response contract changed.

## H. Response and Business Logic Parity

- Exact rich synthetic Weekly response equality passed between the former ORM
  completion path and the reused stored-row path.
- Every benchmark warm-up and measured pair returned exact internal equality.
- Completion filtering retains only `quiz`, `video`, `component` and
  `quiz_reading`; all quizzes remain included for legacy quiz-only attempts.
- The reused rows are projected back to the exact former five fields before
  `progress_index`, so no extra metadata can affect completion.
- A 3,617-row deterministic history test preserves duplicates, nulls, input
  ordering and exact field shape.
- A focused soft-delete test preserves historical completion visibility while
  proving that deleted rows still do not contribute hours.
- No-plan/empty output remains `modules=[]`, `weeks=[]`, `selectedWeek=null`
  and skips progress hydration.
- Single/multiple modules and weeks, selected-week ordering, shared quizzes,
  missing fallback KSB relations, null expected hours, attendance, London
  dates/time zones, holidays and reading weeks remain covered.
- Commercial and apprenticeship projections remain identical.
- Active progress transfer explicitly falls back to the old separate live
  completion query.
- Anonymous, other-learner and employer denial still occurs before the reader.
- No write-on-read repair or external service call was added.
- Query removal is constant; no per-row query or N+1 was introduced.

## I. Performance Before vs After

Method: pinned `lms_ideal_test` Reader, one warm-up then 20 alternating calls
per variant, same preserved synthetic owner, same 357 rows, component set,
connection and serialization method.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Query count | 3 | 2 | **-1 (-33.3%)** |
| Median service-stage wall | 260.234 ms | 189.656 ms | **-70.578 ms (-27.1%)** |
| p95 service-stage wall | 291.737 ms | 195.740 ms | **-95.997 ms (-32.9%)** |
| DB-client execute median | 239.691 ms | 168.825 ms | **-70.866 ms (-29.6%)** |
| Process CPU median | 15.625 ms | 23.438 ms | **+7.813 ms (+50.0%)** |
| Persisted rows processed | 357 | 357 | unchanged |
| Completion rows | 357 | 357 | unchanged |
| Internal result bytes | 292,523 | 292,523 | unchanged |
| Serialization sample | 6.385 ms | 5.709 ms | -0.676 ms; noisy single sample |
| Peak traced allocation | 1,189,502 B | 1,251,679 B | **+62,177 B (+5.2%)** |
| Errors / timeouts | 0 / 0 | 0 / 0 | unchanged |

The CPU and peak-allocation regressions are reported rather than hidden. They
come from deriving and retaining the five-field legacy completion projection
during the shared read; in exchange, one remote query and its client wait are
removed. Final internal bytes were identical, and the measured wall and p95
improved. Serialization is not the optimized stage. Full rich
Weekly response bytes, HTTP median/p95, TTFB, React render and browser paint
were **not measured**.

The source and query-count tests establish that a normal rich Weekly initial or
detail request removes one query. No numeric full-request latency reduction is
claimed without a Reader-accessible rich Weekly fixture.

## J. Backend Tests

Primary Weekly suite:

```text
backend\.venv\Scripts\python.exe backend\manage.py test \
  coach_api.tests_weekly_learning \
  learner_api.test_weekly_optimization_no_db \
  learner_api.tests_weekly_learning --verbosity=1
```

Result: **PASS — 61/61**.

Previous phase regressions:

- Phase 4J Header/Weekly: **PASS — 47/47**.
- Phase 4K Metrics/permissions: **PASS — 34/34**.
- Phase 4H detail harness: **PASS — 14/14**.
- Phase 4H SQLite projection/shared calculations: **PASS — 32/32**.
- Python compilation for changed Python files: **PASS**.
- Tracked unstaged Phase 4L `git diff --check`: **PASS**; both new untracked
  report files also passed an explicit trailing-whitespace scan.

Benchmark checks:

- Phase 4L progress hydration: **PASS**, 20 alternating samples, exact parity,
  zero error/timeout.
- Final-state Phase 4J empty Dashboard path: **PASS**, exact parity; Weekly
  remains seven queries and 45 bytes.

The already-staged Phase 4H/4K reports contain pre-existing Markdown trailing
spaces/EOF warnings under `git diff --cached --check`. Phase 4L did not edit or
reformat those staged files.

## K. Frontend Tests

No frontend source or test file changed.

```text
npm --prefix frontend run test -- \
  src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx \
  src/pages/workspace/learner/__tests__/DashboardTrainingPlan.test.tsx \
  src/pages/workspace/learner/__tests__/DashboardWeeklyLearningPlan.test.tsx \
  src/api/__tests__/dashboardHeader.test.ts \
  src/api/__tests__/weeklyLearningContract.test.ts --maxWorkers=2
```

Result: **PASS — 60/60**.

This verifies initial request order, selected-week priming/navigation, learner
cache isolation, lazy tabs, Training Plan navigation, exact Weekly contracts,
loading/error transitions and absence of extra frontend requests.

The full TypeScript check was not rerun: no frontend file changed, and the two
immediately preceding phases recorded unavailable `lottie-react` and a separate
long-running check. It remains **BLOCKED / NOT RUN**, not passed.

## L. Existing Unrelated Failures

```text
npm --prefix frontend run test -- \
  src/api/__tests__/learnerContentLoading.test.ts --maxWorkers=2
```

Result: **5 failed / 2 passed**, exactly the known baseline. Four fixtures fail
the existing learner/component identity guard and one mock returns invalid
JSON. No Phase 4L file participates in these failures.

## M. Remaining Bottlenecks

1. A rich Weekly fixture is still required for current full initial/detail
   timings, final payload bytes and complete query attribution.
2. Weekly still reads modules, authored weeks, components, attendance/session
   markers, selected details, live evidence and hour reconciliation. None was
   changed without a measured duplicate.
3. Minimal Header remains eight remote queries on the initial critical path.
4. Training Plan overview/upcoming remains unmeasured as a complete service
   request and may repeat plan/module/calendar work across its sections.
5. Student Activity retains a broad consolidated history response without a
   current complete benchmark.
6. Optional subject-attempt and rich attendance relations remain outside the
   least-privilege Reader manifest.

## N. Recommended Next Request

Optimise **Minimal Dashboard Header** next only after decomposing its remaining
eight statements. It has the strongest current safe evidence: 553.473 ms
service median in the final Phase 4L Reader run and it gates every initial
Dashboard load.

In parallel, establish a safe Reader-compatible measurement for Training Plan
`?section=overview` and rich Weekly without changing privileges or fixture
data. Training Plan is the next priority for measurement, but it should not be
edited until its module, session, review and canonical-progress costs are
separated.

## O. Safety Confirmation

- Database target was only `lms_ideal_test`, database `neondb`, branch
  `br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, role
  `lms_benchmark_reader`, with `transaction_read_only=on`.
- Production and parent `lms-ideal-architecture` were not accessed.
- No database write, existing learner mutation, fixture mutation or cleanup
  occurred.
- No schema/index change or migration was created or run.
- No Teams, Graph, Azure, SMTP or other external integration was enabled or
  called.
- Authentication, object ownership and error responses are unchanged.
- No frontend UI/UX, loading state, lazy-loading behavior or API contract
  changed.
- No Teams-trigger file or imported Teams contract was edited; Teams baseline
  and expanded checks are **NOT REQUIRED**.
- Existing staged files and Phase 4H–4K contributor changes were preserved;
  Phase 4L did not alter their staging state.
- No branch/worktree operation, commit or push was performed.
