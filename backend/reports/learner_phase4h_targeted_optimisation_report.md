# Phase 4H — Targeted Learner Backend Performance Optimisation

Date: 2026-10-28 (Africa/Cairo)  
Branch/workspace: current `fix/api-endpoints` checkout  
Verdict: **PARTIALLY OPTIMISED**

## A. Verdict

The remaining Learner Detail progress-row transfer has been narrowed without
changing the response contract, query count, ordering, authentication, object
ownership, formulas, or persistence behaviour.

The optimisation is verified at the isolated PostgreSQL/ORM SELECT boundary:
on the same pinned Reader-only test branch and identical rows, the client-wall
median improved by **6.3% for the p95-history shape (1,116 rows)** and **11.3%
for the maximum-history shape (3,617 rows)**. The maximum SQL result shrank by
**152,401 raw bytes (6.8%)**, its gzip representation shrank by **11.3%**, and
peak fetch memory fell by **7.6%**. Row and ordering parity passed for every
shape, with zero errors or timeouts.

This is classified as `PARTIALLY OPTIMISED`, rather than making an endpoint-wide
claim, because authenticated HTTP remained unavailable, nested relationship
queries and final JSON serialization were outside this isolated comparison,
and the 51-row shape had a slower remote client-wall sample despite essentially
unchanged PostgreSQL execution time. No HTTP p50 or p95 is claimed.

## B. Selected Endpoint

| Item | Selected path |
|---|---|
| Endpoint | `GET /learner_api/learner-detail/{kind}/{id}/?content=summary` |
| Route/view | `learner_api.urls` → `learner_detail.learner_detail` |
| Request work | `build_learner_detail` → `_active_profile_for_source` → progress/nested-relation prefetch → `LearnerProfile.training_plan_progress` and `activity_feed_entries` → `to_learner_detail` |
| Frontend API | `frontend/src/api/learnerDetail.ts` `detailResource` / `fetchLearnerDetail` |
| Principal Learner consumers | `useLearnerDetailParam`; Progress, Learning Plan, Profile, Evidence, Monthly Cycle/Submission, and non-module My Learning views |
| Pagination | Not paginated; no pagination behaviour was introduced or changed |

## C. Why This Bottleneck Was Selected

Phase 4C recorded these remaining/current SQL signals after the Phase 4B work:

| Candidate | Endpoint and function | Frontend consumer | Existing evidence | Current status before 4H | Potential impact | Behaviour risk |
|---|---|---|---|---|---|---|
| Full progress ORM SELECT — **selected** | Learner Detail summary; `_active_profile_for_source` and `training_plan_progress` | `fetchLearnerDetail` / `useLearnerDetailParam` on several learner pages | Phase 4C `pg_stat_statements`: **675.253 ms mean**, 15 calls, 268,804 returned rows; isolated population p50/p95/max history was 357/1,116/3,617 | Still selected every model column. Phase 4D changed quiz ownership and Phase 4E changed My Learning canonical SQL, not this SELECT | Critical shared Learner response; cost scales directly with learner history | Medium: broad contract and nested relations, but four unused internal columns can be removed without changing calculations |
| Canonical metrics bulk progress | `/metrics/.../?view=learner-overview`; `learner_metrics` → `metrics_bulk` | `useLearnerMetrics`, Progress and learner-overview clients | Phase 4C mean **321.262 ms**, 24 calls | Explicit columns and bounded bulk reads already exist; Phase 4E rejected changing its activity-source joins without request evidence | Visible on Progress, but lower measured statement mean | Medium/high: KSB points, completion and OTJH formulas consume many fields |
| My Learning catalogue ledger | `/my-learning/.../`; `read_catalogue` → `entries_for(catalogue_summary=True)` | `useMyLearningCatalogue` | Phase 4E max after-state DB-client p50 **2,597.304 ms**, p95 **3,899.322 ms**, SQL-row output 5,175,250 bytes | Already targeted in Phase 4E; maximum server plan improved 42.1%, while remaining row-transfer/request-stage cost is not attributed | Potentially high, but selecting it again would repeat a completed phase without new request evidence | High: current/historical placement, attendance, completion, replacement and hours parity |
| Dashboard weekly initial | `/dashboard/.../weekly/plan/`; `dashboard_weekly` | `useWeeklyLearning` | Historical projection evidence: 6.05–9.21 s, 16 queries, 49,143 raw bytes for one representative | Previously optimised and not currently HTTP-profiled | High user visibility | High: schedule, holidays, dates, live sessions, progress and retained content |

Quiz Ownership (~1,897 ms) and Activity Sources (~1,102 ms) were excluded because
they were already addressed in Phases 4D and 4E. Phase 4G.7 produced no HTTP
samples and therefore supplied no newer request-level ranking. The selected full
progress SELECT was the highest remaining measured statement that mapped to a
current shared Learner request without reopening a completed phase.

## D. Root Cause

`_active_profile_for_source` correctly prefetches progress, KSB links, quiz
answers, chosen answers, and correct answers to avoid N+1 queries. The progress
query itself, however, used the related manager's default full model SELECT.

Four selected model columns are not read by either learner-facing projection:

- `entry_order` controls SQL ordering only and does not need to be transferred.
- `component_link_status`, `legacy_component_ref`, and
  `component_link_source` are internal reconciliation metadata not used by
  `training_plan_progress` or `activity_feed_entries`.

On the authorised test snapshot these columns average about 75 bytes per row in
aggregate. The cost therefore grows with the complete history that the response
must retain. The root cause was unnecessary row width, not an N+1, missing
index, business formula, or Python loop.

## E. Exact Code Changes

1. `backend/learner_api/learner_detail.py`
   - Added `LEARNER_DETAIL_DEFERRED_PROGRESS_FIELDS` with the four internal fields.
   - Replaced string-only nested progress lookups with a `Prefetch` carrying a
     deferred-field queryset.
   - Kept the same nested KSB/quiz-answer prefetch graph and model ordering.

2. `backend/learner_api/tests.py`
   - Verifies the exact deferred set and unchanged nested prefetch lookups.
   - Constructs a real Django model instance with those four fields genuinely
     deferred and proves that progress and activity-feed projections exactly
     match a fully loaded instance without any deferred-field database read.

3. `backend/reports/benchmark_learner_progress_prefetch_phase4h.py`
   - Adds a reproducible Reader-only before/after benchmark with exact target
     guards, 20 alternating samples, row/order parity, plans, bytes, memory and
     error accounting.

No frontend, schema, migration, index, settings, API route, or business-rule
file was changed.

## F. Response and Business Logic Parity

- Shared-row values were byte/value equivalent across old and narrowed SQL for
  all four benchmark shapes.
- Progress-row order was identical for 51, 357, 1,116 and 3,617 rows.
- `training_plan_progress` and `activity_feed_entries` returned identical Python
  objects for fully loaded and genuinely deferred model instances.
- Nested KSB links, quiz answers, chosen answers and correct answers retain the
  same bounded prefetches.
- The summary endpoint remains read-only and keeps exact field/null/zero
  behaviour in the existing source-parity harness.
- Commercial and apprenticeship routes, allowed staff/admin access,
  cross-learner denial, anonymous denial and unreadable-session behaviour are
  unchanged and passed.
- Programme, KSB and OTJH calculations are untouched. Decimal conversion,
  timestamps/time zones, completion, marking, live attendance and retained
  quiz behaviour are untouched.
- The endpoint has no pagination; this optimisation neither adds nor changes it.

## G. Tests

| Requirement | Evidence |
|---|---|
| Response parity / exact structure | `test_learner_detail_o05_no_db.py` compares old/current response bytes and objects across empty, one and multiple native/source/mixed graphs; 14/14 passed |
| Deferred-row projection parity | `LearnerDetailPrefetchTests.test_deferred_internal_columns_preserve_progress_and_feed_projection`; passed |
| Stable ordering | Benchmark row/order parity passed at all four history sizes |
| Empty data | Existing empty prefetched-history test and O05 empty graph; passed |
| Large data | 1,116- and 3,617-row benchmark shapes; parity passed |
| Cross-learner / anonymous denial | O05 owner/staff/admin/learner/employer/anonymous matrix; passed |
| No writes | O05 summary read-only and concurrent-read tests; passed; live benchmark role and transaction were read-only |
| No external integrations | O05 audit-guarded source harness; benchmark contacted only the pinned Neon Reader endpoint |
| Business formulas | Learner KSB snapshot, progress/feed, and summary OTJH reuse focused tests; passed |
| No deferred-field N+1 | Real deferred model test ran under `SimpleTestCase`, where any database access fails; passed |
| Reader-backed application prefetch | The exact narrowed `Prefetch` loaded the preserved synthetic fixture in 3 bounded queries; 357 rows projected with **0 additional queries** and the exact four-field deferred set |

Commands and results:

```text
python -B learner_api/test_learner_detail_o05_no_db.py
PASS — 14 tests

DJANGO_USE_SQLITE=true; CURRICULUM_WARM=0;
python manage.py test learner_api.tests.LearnerDetailPrefetchTests
  learner_api.tests.LearnerActivityFeedProjectionTests
  learner_api.tests.ProgressActivityProjectionTests
  learner_api.tests.LearnerKsbSnapshotTests
  learner_api.test_learner_summary_performance_no_db
  --settings=config.settings_sqlite_test --verbosity=1
PASS — 32 tests; no database setup was needed

python -B reports/benchmark_learner_progress_prefetch_phase4h.py
PASS — 4 shapes × 20 alternating samples per variant; zero errors/timeouts

AST parse of all three changed Python sources
PASS

python -m ruff check <changed Python files>
BLOCKED / NOT RUN — the environment has no `ruff` module installed

npm --prefix frontend test -- --run src/api/__tests__/learnerRead.test.ts --maxWorkers=1
PASS — 26 tests

npm --prefix frontend test -- --run src/api/__tests__/learnerContentLoading.test.ts --maxWorkers=1
FAIL — 2 passed, 5 failed in unchanged frontend fixtures. Four failures reject
fixture activity payloads that do not satisfy the existing `id`/`componentId`
guard in `frontend/src/api/learnerDetail.ts`; one fixture returns an invalid JSON
response. No frontend source or test file differs from Git HEAD, and the same
five failures reproduce when this file runs alone. They were not changed as
part of this backend-only phase.

Guarded Reader-backed narrowed progress prefetch check
PASS — role `lms_benchmark_reader`, branch `br-orange-shadow-abm8uwwe`, read-only;
3 load queries, 357 prefetched/projection rows, 0 deferred-field projection queries

Guarded Reader-backed complete `_active_profile_for_source` check
BLOCKED before progress prefetch — Reader has no SELECT privilege on
`Learner.learner_ksb_assignments`. No privilege or application change was made.
```

## H. Performance Before vs After

Environment and method:

- Neon project test branch: `lms_ideal_test` (`br-orange-shadow-abm8uwwe`).
- Endpoint: `ep-dawn-block-ab5vob3x`; database `neondb`.
- Role: `lms_benchmark_reader`; `transaction_read_only=on`.
- One parity warm-up, then 20 alternating samples per variant and shape.
- Same database, connection, rows, ordering and cache state sequence for each pair.
- PostgreSQL/ORM SELECT measurement only; no HTTP requests were executed.

| Shape | Rows | Client median before → after | Client p95 before → after | Raw SQL result before → after | Peak fetch memory before → after | Rows examined | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| Small | 51 | 107.640 → 140.410 ms (**+30.4%**) | 220.718 → 1,140.647 ms | 23,113 → 22,151 B (-4.2%) | 65,681 → 64,173 B (-2.3%) | 51 → 51 | 0 |
| Median | 357 | 235.076 → 228.378 ms (**-2.8%**) | 782.346 → 301.292 ms | 140,054 → 132,941 B (-5.1%) | 357,896 → 342,850 B (-4.2%) | 357 → 357 | 0 |
| p95 history | 1,116 | 761.544 → 713.419 ms (**-6.3%**) | 1,149.707 → 1,176.920 ms (+2.4%) | 651,566 → 625,495 B (-4.0%) | 1,655,495 → 1,579,282 B (-4.6%) | 1,116 → 1,116 | 0 |
| Maximum | 3,617 | 1,000.212 → 887.618 ms (**-11.3%**) | 1,592.532 → 1,409.043 ms (**-11.5%**) | 2,253,732 → 2,101,331 B (-6.8%) | 6,036,374 → 5,577,842 B (-7.6%) | 3,617 → 3,617 | 0 |

Query count remained **1 → 1** for the progress SELECT. The nested relationship
prefetch count is structurally unchanged and was not re-labelled as part of the
single-query timing.

PostgreSQL execution time stayed very small relative to remote client wall
(approximately 0.16/0.17 ms for small, 0.51/0.63 ms for median, 1.77/1.86 ms
for p95 history, and 5.08/6.36 ms for maximum). This confirms the improvement is
from less row transfer/client materialisation, not a better scan or fewer rows.
The small-shape wall regression and p95-history tail movement are reported as
remote connection variance/overhead; the deterministic byte and memory
reductions remain present at every size.

HTTP median, HTTP p95, TTFB, final response bytes and compression are **NOT
MEASURED**. SQL-result bytes are not presented as API payload bytes.

## I. Remaining Bottlenecks

- The response must still load all contract-required progress fields and nested
  KSB/quiz-answer relations. This change removes only proven unused columns.
- Phase 4E's My Learning maximum catalogue SQL still returns a large result;
  request-stage evidence is needed before changing its contract or aggregation.
- Canonical metrics bulk progress and KSB reads remain the next lower measured
  SQL candidates (321.262 ms and 277.981 ms historical means respectively).
- Dashboard weekly has high historical request-projection timings, but lacks a
  current safe authenticated HTTP baseline.
- Final JSON serialization, middleware/authentication, connection acquisition,
  nested prefetch timings and total endpoint latency remain unmeasured.
- The complete Reader-backed profile helper cannot be executed with the current
  least-privilege manifest because `learner_ksb_assignments` is intentionally
  unavailable; the changed progress prefetch itself executed successfully and
  added zero deferred-field queries.
- Five existing `learnerContentLoading.test.ts` fixture/contract assertions are
  failing in unchanged frontend code; the independent `learnerRead` contract
  suite passes 26/26.

## J. Next Recommended Request

Profile `GET /learner_api/metrics/{kind}/{id}/?view=learner-overview` next, with
the same Reader-only isolation and exact response parity. Target the canonical
metrics progress/KSB materialisation, **not** the Phase 4E-rejected activity-
source join rewrite. Only implement a change if request or isolated query
evidence proves a removable field/read without changing KSB point labels,
completion, OTJH hours, monthly targets or identity validation.

## K. Safety Confirmation

- Production: **not accessed**.
- Parent `lms-ideal-architecture` branch/database: **not accessed**.
- Database target: pinned `lms_ideal_test` Reader endpoint only.
- Database writes: **none**; `transaction_read_only=on`.
- Schema/index changes: **none**.
- Migrations: **none created or run**.
- Fixture creation, alteration or cleanup: **none**.
- Existing Learner records: **not altered**.
- External Teams, Graph, Azure and SMTP: **not enabled or contacted**.
- Teams baseline: **NOT REQUIRED** — no listed Teams file or directly consumed
  Teams function/type/response was changed.
- Expanded Teams checks: **NOT REQUIRED**.
- Live Teams: **NOT RUN**.
- HTTP server/browser benchmark: **not run**.
- Authentication/permissions: unchanged; focused denial matrix passed.
- API contract/business formulas/time-zone behaviour: unchanged.
- Frontend source: unchanged.
- Unrelated source changes: none introduced by Phase 4H.
- Commit/push/branch/worktree: **none**.

