# Phase 4J — Learner Dashboard Initial Loading

## A. Verdict

**PARTIALLY OPTIMISED**

The measured Django/service critical path is 10.97% faster at the median and uses two fewer PostgreSQL round trips. Response payloads are exactly equal and the frontend request graph is unchanged. The result is partial rather than fully verified because no browser/HTTP timing was available, the least-privilege Reader could benchmark Weekly only with an empty-plan fixture, the after p95 was noisy rather than improved, and the repository-wide TypeScript check is blocked by a missing installed `lottie-react` module.

## B. Initial Request Inventory

Cold navigation to `/workspace/learner/dashboard` has three source-inferred sequential API reads:

1. `GET /login_api/me/` — `AuthProvider` establishes the authenticated actor before protected route resolution.
2. `GET /learner_api/dashboard/{kind}/{id}/header/minimal/` — `useDashboardHeader` supplies the identity/access gates, hero/header cards, visible modules and authoritative initial Weekly module.
3. `GET /learner_api/dashboard/{kind}/{id}/weekly/plan/?moduleId=...` — the default Weekly tab starts only after Header succeeds. Its response primes the selected-week detail cache, so the initial selected week does not issue a second detail request.

The Dashboard contributes two initial requests. There is no duplicate Header, Weekly or selected-week request. Overview, Monthly, Training and Rewards remain visit-triggered lazy tabs. Adjacent-week prefetch is delayed and is not a first-content dependency.

## C. Dependency Waterfall

```text
workspace route
  -> AuthProvider: /login_api/me/
     -> resolve protected learner route / learner identity
        -> page.tsx: useDashboardHeader
           -> Header authorization + identity + minimal presentation
              -> render learner hero/header and mount default Weekly tab
                 -> Weekly Initial with Header's moduleId
                    -> prime selected-week cache and render Weekly content

Tab-only, outside the default initial path:
  Overview -> /dashboard/{kind}/{id}/overview/ (+ module progress on demand)
  Monthly  -> /dashboard/{kind}/{id}/monthly/plan/
  Training -> /dashboard/{kind}/{id}/training/ (+ selected module on demand)
  Rewards  -> rewards data when the tab is visited
```

The Header gate remains intentionally sequential. Starting Weekly before Header would perform protected learner data work before the page's authoritative identity/access result and would contradict the existing denial/request-order tests.

## D. Baseline Measurements

Measurement type: isolated read-only Django/service components on the pinned `lms_ideal_test` Neon branch, using `lms_benchmark_reader`; not HTTP and not a browser navigation measurement. The database identity guard verified branch `br-orange-shadow-abm8uwwe`, endpoint `ep-dawn-block-ab5vob3x`, database `neondb`, role `lms_benchmark_reader`, and `transaction_read_only=on`.

Twenty alternating iterations per variant were collected after warm-up. The anonymous synthetic fixture is a valid Header/Weekly learner but has an empty Weekly plan. Richer candidate fixtures reached a Reader privilege boundary on `live_session_learner_attendance`; no grants or data were changed.

Baseline endpoint evidence:

| Component | Queries | SQL median | Residual Python median | Serialization median | Payload |
|---|---:|---:|---:|---:|---:|
| Minimal Header | 9 | 584.312 ms | 11.544 ms | 0.093 ms | 677 B |
| Weekly Initial | 8 | 504.052 ms | 8.929 ms | 0.046 ms | 45 B |
| Sequential Dashboard components | 17 | 1091.861 ms | 20.893 ms | 0.139 ms | 722 B |

The initial request count and waterfall are source-inferred and test-verified. Timings above are backend service measurements; they exclude `/login_api/me/`, network transfer, React work, paint and browser scheduling.

## E. Dominant Bottleneck

The dominant measured cost was database network time: 1091.861 ms of the 1113.127 ms baseline median. Two required endpoints repeated facts already available within their own request:

- Minimal Header read cohort delivery dates separately even though it immediately performed the canonical profile read containing the stable cohort placement.
- Weekly Initial performed a second ORM profile bridge lookup after `canonical_learning.require_profile()` had already validated the enrolment/profile bridge, email and Aptem identity.

Merging endpoints or parallelising Weekly before Header was rejected as higher-risk and unnecessary. Payload serialization was negligible and no initial metrics/training-summary request was found.

## F. Code Changes

- `learner_api/dashboard_header.py`
  - folds the cohort delivery window into the already-required profile SELECT;
  - caches the resolved learner/cohort window on the request-local source before `header_identity` consumes it;
  - retains the onboarding early return, canonical identity validation and exact minimal Header contract.
- `learner_api/dashboard_weekly.py`
  - reuses the canonical owner's validated `id` and `enrolment_id` to construct the ORM identity needed only for the reverse `progress_entries` relation;
  - keeps fail-closed enrolment mismatch handling and all existing authorization decorators.
- Focused regression tests cover delivery-window reuse, canonical owner reuse and mismatch denial.
- `reports/benchmark_learner_dashboard_phase4j.py` provides the guarded, anonymised, SELECT-only reproduction harness.

No frontend production file, schema, migration, stored learner record or API response contract changed.

## G. Before/After Performance

| Metric | Before | After |
|---|---:|---:|
| Initial API requests (cold route, source-inferred) | 3 including auth; 2 Dashboard | unchanged |
| Critical sequential requests | auth -> Header -> Weekly | unchanged |
| Dashboard SQL query count | 17 | 15 |
| SQL median | 1091.861 ms | 971.891 ms (-10.99%) |
| Residual Python median | 20.893 ms | 18.837 ms (-9.84%, derived/noisy) |
| Serialization median | 0.139 ms | 0.141 ms (effectively unchanged) |
| Dashboard component median | 1113.127 ms | 991.013 ms (-10.97%) |
| Initial Dashboard payload bytes | 722 B | 722 B |
| Redundant database reads addressed | 2 | 0 |

Endpoint medians:

- Minimal Header: 597.137 -> 537.139 ms; 9 -> 8 queries.
- Weekly Initial: 513.386 -> 454.206 ms; 8 -> 7 queries.

The combined p95 was 1334.425 ms before and 1888.441 ms after. This is treated as Neon/outlier noise, not an improvement claim. No browser loading-time or HTTP p95 claim is made.

## H. API and Business Logic Parity

- Benchmark payload equality: exact equality on warm-up and every measured pair.
- Header and Weekly response bytes: unchanged.
- Request count/order: unchanged; exactly one Header then one Weekly Dashboard request.
- Module selection, progress, hours, review/session/assignment cards, dates, time zones and precision: unchanged.
- Anonymous, employer and cross-learner denial stays before protected reads.
- Learner switching remains isolated by existing kind/id cache keys and request graph tests.
- No writes, external calls, UI redesign, loading-state change or lazy-tab change was introduced.

## I. Backend Tests

PASS — 47/47:

```text
python -c "... loadTestsFromNames(['learner_api.test_dashboard_header_no_db',
                                   'learner_api.tests_weekly_learning']) ..."
```

The focused coverage includes Header contract/authorization/cache headers, onboarding delivery-read avoidance, both learner kinds, Weekly authorization parity, read failures, canonical identity reuse, and fail-closed mismatches.

PASS — benchmark:

```text
python backend/reports/benchmark_learner_dashboard_phase4j.py
```

Twenty alternating iterations per variant, exact response parity, pinned read-only Reader identity.

## J. Frontend Tests

PASS — 42/42:

```text
npm --prefix frontend run test -- \
  src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx \
  src/pages/workspace/learner/__tests__/DashboardTrainingPlan.test.tsx \
  src/api/__tests__/dashboardHeader.test.ts --maxWorkers=2
```

These verify the initial loading/denial transitions, one Header plus one Weekly read, Header-selected module, Weekly rendering, cache isolation and lazy tab behaviour.

BLOCKED — repository TypeScript check:

```text
npm --prefix frontend run type-check
```

The check stops at `src/components/SupportChatWidget.tsx(18,24): TS2307`, because the installed frontend dependencies cannot resolve `lottie-react`. Phase 4J changed no frontend source or dependency file, and no package installation was performed.

## K. Known Unrelated Failures

Rechecked without modification:

```text
npm --prefix frontend run test -- \
  src/api/__tests__/learnerContentLoading.test.ts --maxWorkers=2
```

Result: 5 failed, 2 passed — exactly the five failures identified before Phase 4J. Four reject fixture activity identity and one receives invalid JSON. No Phase 4J file participates in these failures.

An initial Vitest invocation from the repository root also collected 0 tests because the `@/` alias was resolved against the wrong root. It was corrected by using the frontend package script; the valid focused run then passed 42/42.

## L. Remaining Bottlenecks

- The safe default remains three sequential cold-route requests including auth. Header must remain the authorization/identity gate unless a separately designed authenticated bootstrap contract can prove equivalent denial semantics.
- The two Dashboard endpoints still execute 15 queries in the empty-plan fixture; most measured time is Neon round-trip latency.
- Rich Weekly measurement is blocked for the benchmark Reader by its deliberate table privilege boundary.
- The p95 sample was unstable, so production/browser tail latency remains unverified.

## M. Next Recommended Optimisation

Profile the remaining eight Header statements with a richer read-only fixture and browser request timings. The next candidate should be a measured consolidation of Header's independent next-review, next-session and next-assignment reads, not a new aggregate endpoint or premature Header/Weekly parallelism. Any follow-up must preserve the Header denial gate and exact card contracts.

## N. Safety Confirmation

- Worked on the existing `fix/api-endpoints` branch and current working folder.
- No branch/worktree creation or switching.
- No commit or push.
- No skill or LMS Forge workflow used.
- No Production or `lms-ideal-architecture` access.
- No migrations, schema changes, data writes, fixture deletion or external integrations.
- Benchmark database was pinned and verified read-only; identities were anonymised.
- Phase 4D, 4E, 4H and 4I changes were preserved.
- No Teams-trigger file was edited; Teams baseline and expanded Teams checks are not required. Live Teams was not run.
