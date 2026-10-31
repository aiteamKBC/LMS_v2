# Phase 4I — Learner Metrics Request Performance Optimisation

## A. Verdict

**PARTIALLY OPTIMISED**

The default Learner Progress metrics path now reuses the existing one-query
`training_summary` canonical projection instead of hydrating the broader
`lineage_only` ledger.  Across four anonymised Reader datasets the final Python
payload was exactly equal before and after, query count stayed at three, and
median service time improved by 7.5% to 36.3% as history grew.

The verdict is deliberately partial rather than fully verified because:

- these are isolated Django service measurements, not authenticated HTTP timings;
- the largest valid metrics profile returned 2,790 current progress rows, not 3,617;
- `EXPLAIN ANALYZE` did examine 3,617 progress rows at that shape, including rows
  removed by the live predicate;
- the least-privilege Reader cannot read the optional KSB-exclusion and subject
  attempt relations, so both compared variants disabled those two optional reads
  inside the benchmark only.  Production code and predicates were not changed.

## B. Request Path Map

The historical Phase 4C `metrics_bulk` statement is not the default request made
by the Learner Progress page.  The page calls the endpoint without a `view`
parameter, which selects `canonical_learning.metrics()`.

| Page / consumer | Endpoint | Backend entry point and service | Main read | Initial / lazy |
|---|---|---|---|---|
| Learner Progress detail | `GET /learner_api/learner-detail/{kind}/{id}/` | `learner_detail.learner_detail` | Learner plan/detail projection, including the Phase 4H narrowed progress prefetch | Initial |
| Learner Progress availability prefetch | `GET /learner_api/learner-summary/{kind}/{id}/` | `learner_detail.learner_summary` | Compact learner availability/identity summary | Initial, started beside detail |
| Learner Progress metrics — optimised here | `GET /learner_api/metrics/{kind}/{id}/` | `dashboard_metrics.learner_metrics` → `read_metrics` → `canonical_learning.metrics` | Canonical `entries_for(training_summary=True)`, monthly targets, and applicable review plan | Gated by `isRealMode`; starts after detail establishes real mode |
| Learner Progress activity history | `GET /learner_api/student-activity/{kind}/{id}/` | `student_activity.student_activity` | Student activity/canonical catalogue projection | Prefetch is sequential after summary confirms availability; visible hook reuses the shared request/cache |
| Learner Progress subject metadata | `GET /learner_api/subject-covers/{id}/?refs=...` | `student_activity.subject_covers` | Assigned cover/activity-date metadata | After activity data when history is required |
| Progress Overview / OTJH / KSB tabs | No new metrics endpoint | Tabs consume the already loaded detail, activity, covers, and metrics state | None on tab change | In-memory tab switch |
| Coach learner overview metrics | `GET /learner_api/metrics/{kind}/{id}/?view=learner-overview` | `learner_metrics` → `metrics_bulk(..., learner_workspace=True, include_ksb_points=True)` | Existing bounded bulk projections | Separate consumer; not the default Learner Progress request |

Source trace:

- `frontend/src/pages/learner/progress/page.tsx:39-46` starts summary/activity
  prefetch, detail, metrics, and unified learning data.
- `frontend/src/hooks/useLearnerMetrics.ts:6-11` delegates to the metrics API.
- `frontend/src/api/learnerMetrics.ts:39-49` builds the default URL and applies
  the existing 30-second client read TTL.
- `frontend/src/hooks/usePrefetchStudentActivity.ts:7-16` shows the summary →
  student-activity dependency.
- `frontend/src/pages/learner/my-learning/useSubjectLearningData.ts:36-83`
  shows activity → subject-cover metadata sequencing.
- `backend/learner_api/urls.py:249-274` maps the routes.
- `backend/learner_api/dashboard_metrics.py:496-521` selects default metrics or
  the explicit learner-overview bulk branch.
- `backend/learner_api/canonical_learning.py:1310-1327` is the optimised default
  metrics service.

## C. Current Baseline

The baseline implementation called:

```python
entries_for(owner, lineage_only=True)
```

`lineage_only` removed most raw evidence content, but its canonical CTE still
selected `progress.*`, converted the full row with `to_jsonb`, and materialised
complete reporting-segment and historical-component JSON bodies.  Metrics later
returned only counts, ratios, hours, KSB code totals, and plan values.

Measurement environment:

- branch: `lms_ideal_test` (`br-orange-shadow-abm8uwwe`);
- endpoint: `ep-dawn-block-ab5vob3x`;
- database: `neondb`;
- role: `lms_benchmark_reader`;
- `transaction_read_only=on`;
- 20 alternating measured iterations per variant, preceded by warm-up;
- identical owner, request context, query parameters, and Python equality check;
- no HTTP server, impersonation, mutation, cache warm API, or external integration.

The service benchmark deliberately measures a cache miss.  The unchanged
frontend read layer keeps the metrics response for 30 seconds; no new backend
cache or invalidation rule was introduced.

## D. Dominant Bottleneck

The measured dominant cost was the canonical ledger read and its result
materialisation, not response serialization and not the historical
`metrics_bulk` statement.

At the 2,790-current-row shape, the former path spent a median 4,512.2 ms inside
database execute calls and 5,564.5 ms in the measured service call.  JSON
serialization of the final response was only 0.330 ms.  The response was 5,468
bytes, so reducing final response fields could not address the dominant cost.

## E. Root Cause

`metrics()` asked the general ledger reader for a lineage-safe but otherwise
broad record.  That projection retained fields and nested JSON required by
other consumers but unused by metrics:

- full progress rows instead of explicit timing/completion/lineage fields;
- full reporting-segment JSON instead of the presence marker used by current-save reconciliation;
- full historical-component JSON instead of its source identity;
- feedback and other evidence-facing fields never returned by metrics.

The repository already had a compatible `training_summary` projection used by
summary-style consumers.  Reusing it avoids a new SQL design, schema/index
change, cache, or additional round trip.

## F. Exact Code Changes

1. `backend/learner_api/canonical_learning.py`
   - changed only the default single-learner metrics ledger request from
     `entries_for(owner, lineage_only=True)` to
     `entries_for(owner, training_summary=True)`;
   - retained the same owner validation, target lookup, programme-plan override,
     review planned-hours inclusion, metric calculator, and response object.
2. `backend/learner_api/test_canonical_metrics_bulk_no_db.py`
   - added summary-projection selection, representative-size/query-count,
     empty/null/decimal, and KSB ordering assertions.
3. `backend/learner_api/test_home_round_trips_no_db.py`
   - updated the request-path assertion to require `training_summary=True`.
4. `backend/reports/benchmark_learner_metrics_phase4i.py`
   - added a guarded, anonymised, reproducible Reader-only before/after harness.

No frontend production file, model, migration, schema, API serializer, URL,
permission decorator, or business formula changed.

## G. Response Parity

Every one of the 20 measured iterations at each shape compared the complete
Python response dictionary using exact equality.  All four shapes passed:

| Shape | Current progress rows | Exact payload parity | Ordering parity | Payload bytes before / after |
|---|---:|---|---|---:|
| Small | 52 | PASS | PASS | 1,382 / 1,382 |
| Median target | 357 | PASS | PASS | 356 / 356 |
| Large target | 1,105 | PASS | PASS | 2,812 / 2,812 |
| Maximum valid metrics profile | 2,790 | PASS | PASS | 5,468 / 5,468 |

The same `metrics_from_records` function still owns completion, accepted-hour,
KSB, decimal, null, percentage, and rounding rules.  The final payload field
names and types are unchanged.

Reader limitation: the parity run replaced `_ksb_not_excluded()` with `TRUE`
in both variants and treated the optional attempts relation as absent because
the Reader lacks `SELECT` on those relations.  This was benchmark-only
monkey-patching; application behavior was not altered.  Deterministic tests
cover KSB pair counting, empty progress, null seconds, decimal hours, code
ordering, source completion, and representative in-memory sizes.

## H. Tests

Backend final-state focused command:

```text
backend\.venv\Scripts\python.exe backend\manage.py test \
  learner_api.test_canonical_metrics_bulk_no_db \
  learner_api.tests_dashboard_metrics.DashboardMetricsTests.test_live_metrics_read_is_ssot_only \
  learner_api.tests_dashboard_metrics.DashboardMetricsTests.test_endpoint_scopes_identity_and_returns_retryable_error \
  learner_api.tests_dashboard_metrics.LearnerOverviewMetricsEndpointTests \
  login.tests_learner_progress_gate --verbosity=1
```

Result: **PASS, 32/32**.  This includes the metrics contract, query-count
stability, empty/single/357/1,116/3,617 deterministic shapes, null/decimal and
ordering behavior, endpoint selection/error behavior, and the unchanged
anonymous/cross-learner permission gate.

Frontend metrics compatibility:

```text
npm --prefix frontend test -- --run \
  src/hooks/__tests__/useLearnerMetrics.test.tsx \
  src/api/learnerMetrics.test.ts --maxWorkers=1
```

Result: **PASS, 13/13**.

The benchmark itself verified exact response equality, stable query count, no
timeout in the retained final runs, and the pinned read-only identity before
executing application reads.

No deferred-field access was introduced: this path consumes dictionaries from
the canonical SQL projection rather than deferred Django model instances.

## I. Performance Before vs After

These are direct Django service timings, not end-to-end HTTP timings.

| Shape | Measurement | Before | After | Change |
|---|---|---:|---:|---:|
| 52 | Query count | 3 | 3 | 0 |
| 52 | Service median | 417.044 ms | 385.660 ms | **-7.5%** |
| 52 | Service p95 | 565.872 ms | 634.750 ms | **+12.2%** |
| 52 | SQL execute median | 399.347 ms | 366.406 ms | -8.2% |
| 52 | Process CPU median | 31.250 ms | 15.625 ms | -50.0% |
| 357 | Query count | 3 | 3 | 0 |
| 357 | Service median | 544.198 ms | 434.886 ms | **-20.1%** |
| 357 | Service p95 | 827.396 ms | 739.119 ms | **-10.7%** |
| 357 | SQL execute median | 487.776 ms | 385.366 ms | -21.0% |
| 357 | Process CPU median | 78.125 ms | 46.875 ms | -40.0% |
| 1,105 | Query count | 3 | 3 | 0 |
| 1,105 | Service median | 1,602.214 ms | 1,162.770 ms | **-27.4%** |
| 1,105 | Service p95 | 3,478.144 ms | 1,886.241 ms | **-45.8%** |
| 1,105 | SQL execute median | 1,450.856 ms | 1,025.435 ms | -29.3% |
| 1,105 | Process CPU median | 281.250 ms | 218.750 ms | -22.2% |
| 2,790 | Query count | 3 | 3 | 0 |
| 2,790 | Service median | 5,564.500 ms | 3,544.014 ms | **-36.3%** |
| 2,790 | Service p95 | 8,511.528 ms | 6,749.807 ms | **-20.7%** |
| 2,790 | SQL execute median | 4,512.214 ms | 2,622.148 ms | -41.9% |
| 2,790 | Process CPU median | 710.938 ms | 507.812 ms | -28.6% |

Final JSON serialization stayed below 0.4 ms at every shape and payload bytes
were identical.  A final comparable memory number is not reported: the maximum
`tracemalloc` run exceeded the practical benchmark window and was discarded,
rather than presenting an incomplete or differently measured result.

The maximum-shape read-only plans were:

| Plan | Planning | Execution | Progress rows examined |
|---|---:|---:|---:|
| Before `lineage_only` ledger | 9.611 ms | 455.062 ms | 3,617 |
| After `training_summary` ledger | 8.974 ms | 442.839 ms | 3,617 |

The equal examined-row count confirms that predicate/selectivity did not change.
The larger client/service gain comes from narrower row and nested JSON
materialisation plus less Python decoding, not skipped learner history.

Negative result retained: small-shape p95 increased 12.2% even though its
median, SQL median, and CPU improved.  This was not hidden or reclassified.

## J. Frontend Compatibility

- The endpoint URL, status behavior, fields, nulls, numeric values, ordering,
  and 30-second client cache behavior are unchanged.
- `useLearnerMetrics` and the API client passed 13/13 focused tests.
- Progress tab changes continue to reuse the already loaded metrics object and
  add no request.
- No new sequential dependency or API call was introduced.
- Loading, retry, and error handling remain in the unchanged frontend hooks and page.
- No frontend production file was edited.

## K. Existing Unrelated Failures

The required unchanged frontend baseline remains reproducible:

```text
npm --prefix frontend test -- --run \
  src/api/__tests__/learnerContentLoading.test.ts --maxWorkers=1
```

Result: **2 passed, 5 failed**, matching the Phase 4H baseline.  Four failures
raise the existing “different activity” guard because fixtures do not satisfy
the current learner/component identity check; one mock returns invalid JSON.
Phase 4I changed no frontend file.

Two broader backend invocations also exposed current-tree assertions outside
the changed metrics projection:

- `CanonicalMetricsPayloadTests.test_only_an_object_payload_is_reduced_to_its_lineage_reference`
  expects an older exact SQL substring that omits the currently present
  `retakeTimeChoice` key.  The failing `lineage_only` SQL was not changed by Phase 4I.
- Five subcases of
  `DashboardMetricsTests.test_metrics_return_activity_sum_when_document_or_its_total_is_missing`
  expect an older soft-delete substring, while the current SQL uses an
  `EXISTS` archive rule.  Phase 4I did not edit that query or helper.

Those failures were not weakened or repaired as part of this task.  The final
32-test focused backend command excludes only those unrelated stale assertions.

## L. Remaining Performance Bottlenecks

1. The canonical summary still examines all learner progress rows and constructs
   KSB/source/journal aggregates.  Maximum service median remains about 3.54 s
   in this remote Reader measurement.
2. The optional KSB-exclusion and subject-attempt paths could not be profiled
   with the least-privilege Reader.
3. Identity lookup, source model lookup, authentication, middleware, network,
   JSON response encoding, and browser timing were not included in the service benchmark.
4. The explicit `view=learner-overview` bulk branch remains a separate request
   path; this change neither optimises nor regresses it.
5. The small-shape p95 result is noisy/negative and should be watched in future
   request-level evidence.

## M. Next Recommended Request

Run a controlled authenticated HTTP GET benchmark for the default
`/learner_api/metrics/{kind}/{id}/` route on the isolated test branch using a
synthetic learner and a non-mutating session.  Capture middleware/auth/source
lookup, response encoding, and browser-visible request latency, while granting
the benchmark Reader only the two missing optional `SELECT` permissions if the
owner separately approves that test-role change.  Do not reuse production
credentials or broaden writes.

If that request profile still shows the canonical CTE as dominant, the next
candidate should be a measured, request-specific aggregation of KSB/completion
facts inside the same SQL round trip.  Do not return to the rejected multi-query
switch without new latency evidence.

## N. Safety Confirmation

- Production: **not accessed**.
- Parent branch / `lms-ideal-architecture`: **not accessed**.
- Database target: pinned `lms_ideal_test`, `neondb`, Reader role, read-only transaction.
- Schema, migrations, indexes: **unchanged**.
- Learner rows, synthetic fixture, cleanup: **unchanged**.
- External Teams, Graph, Azure, SMTP, storage, and paid services: **not called**.
- Authentication and object-level permission decorators: **unchanged**.
- Frontend UI/production code: **unchanged**.
- Teams files: **none edited**; Teams baseline **NOT REQUIRED**.
- Phase 4H contributor changes: **preserved**.
- Branch/worktree creation or switching: **none**.
- Commit/push: **none**.

