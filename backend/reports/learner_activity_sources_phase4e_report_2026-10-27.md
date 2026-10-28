# Phase 4E — Learner Activity Sources and Canonical Progress

Date: 2026-10-27  
Branch: `fix/api-endpoints`  
Verdict: **IMPROVED WITH LIMITATIONS**

## A. Implementation verdict

The My Learning catalogue/upcoming canonical-ledger read is improved with a bounded SQL-only change. The relationship CTEs now receive the already-authoritative learner identity explicitly, allowing PostgreSQL to use the existing learner indexes before aggregation. Query count, response projection, completion/OTJH formulas, ordering, historical lineage, permissions, and read-only behaviour are unchanged.

The result is not classified as fully verified because authenticated HTTP latency was unavailable, two pre-existing frontend assertions still fail, several broader legacy backend suites are stale against the current worktree, and an incorrectly isolated legacy test made one live Azure upload before failing (documented under Remaining risks).

## B. Database environment

- Neon organisation: Kent Business College (`org-falling-sea-18071422`)
- Project: `LMS` (`green-term-97168878`)
- Branch: `lms_ideal_test` (`br-orange-shadow-abm8uwwe`)
- Parent branch: `lms-ideal-architecture` (`br-raspy-sky-abvs8lq9`)
- Branch flags: primary `false`, default `false`, protected `false`
- Endpoint: `ep-dawn-block-ab5vob3x`; Neon exposes direct and pooled hosts, and measurements used the direct host.
- Database: `neondb`; PostgreSQL `18.6 (fd34222)`
- Django aliases checked: `default` and `enrolment` both resolved to the approved endpoint. Audit aliases were disabled for the benchmark.
- Transaction verification: `transaction_read_only=on`; `pg_is_in_recovery=false`.
- Only `LMS_IDEAL_TEST` supplied the database connection. There was no fallback to `DATABASE_URL` as an input source.
- All database profiling used bounded `SELECT` and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` inside a read-only transaction. No database rows, schema, migrations, indexes, or statistics were changed.

Authoritative metadata resolved the underscore branch name `lms_ideal_test`; the earlier hyphenated label was not trusted.

## C. Endpoint dependency map

`Frequency` below is the canonical-ledger SQL frequency, not total endpoint query count. Costs other than the optimised catalogue SQL are not described as request latency because authenticated request profiling was unavailable.

| Endpoint | Canonical function and projection | SQL fingerprint | Frequency | Measured cost | Recommendation |
|---|---|---|---:|---:|---|
| My Learning catalogue | `my_learning.read_catalogue` → `load_context` → `entries_for(lineage_only=True, monthly_summary=True, catalogue_summary=True)` | `d413d31341579f02` → `40c9bb6b34873ad1` | 1 | PostgreSQL 4.198–177.777 ms after, by history size | Optimised here |
| My Learning upcoming | Same `read_catalogue(..., upcoming_only=True)` and catalogue ledger; subsequent upcoming query is bounded separately | Same catalogue fingerprint | 1 | Same ledger workload; total request not measured | Receives this optimisation |
| My Learning search | `read_search` → `load_context(purpose='search')`; intentionally does not call `entries_for`; searches owned `source_activities/source_courses` | `source-title-search-v1` | 0 ledger | Not request-profiled | Keep ledger-free |
| My Learning module detail | `read_module` → `load_context(subject_id)` → `entries_for(lineage_only=True, monthly_summary=True, dashboard_metadata=True)`; legacy module may call `source_subjects` with the already-loaded records | `entries-for-monthly-dashboard-metadata-v1` | 1 | Not request-profiled | Do not inherit catalogue forcing without separate evidence |
| Metrics default | `learner_metrics` → `canonical_learning.metrics` → `entries_for(lineage_only=True)` | `entries-for-lineage-v1` | 1 | Not request-profiled | Unchanged |
| Metrics learner overview | `metrics_bulk([pk], learner_workspace=True, include_ksb_points=True)`; bounded progress, KSB, segment, source and historical reads | `metrics-bulk-v1` | 9 canonical/service queries in the unit contract | Per-learner source statement was fast in isolated plans; two alternative joins regressed | Unchanged |
| Learner progress summary | `learner_summary` or `learner_detail?content=summary`; narrow identity/detail projections, not `entries_for` | `learner-summary/detail-projection-v1` | 0 ledger | Not request-profiled | Unchanged |
| Student Activity | `student_activity` → full `entries_for(owner)` → `source_subjects(..., records=records)`; supplied records prevent a second ledger load | `entries-for-full-v1` plus `source-subjects-v1` | 1 ledger | Not request-profiled | Profile separately before changing |
| Dashboard weekly | Coach weekly reader plus learner-owned progress query; journal-disabled hour fallback can use `weekly_hour_records` → `entries_for(lineage_only=True)` | `weekly-progress-v1` / conditional `entries-for-lineage-v1` | 0 or 1 ledger | Not request-profiled | Unchanged |
| Dashboard overview | `entries_for(training_summary=True)` plus `metrics_bulk([pk], learner_workspace=True)` | `entries-for-training-v1` + `metrics-bulk-v1` | 1 ledger plus bounded metrics reads | Not request-profiled | Unchanged |
| Dashboard monthly | `entries_for(lineage_only=True, dashboard_metadata=True, monthly_summary=True)` | `entries-for-monthly-dashboard-metadata-v1` | 1 | Not request-profiled | Unchanged |
| Dashboard training | `entries_for(training_summary=True)` | `entries-for-training-v1` | 1 | Not request-profiled | Unchanged |
| Learner Detail activity read | `build_learner_detail(..., compact=True, read_only=True, activity_component_id=...)`; filtered learner-owned activity/progress projection, not `entries_for` | `learner-detail-activity-v1` | 0 ledger | Not request-profiled | Unchanged |

Historical fallback remains in the existing functions: `entries_for` retains progress KSBs (outside catalogue mode), reporting segments, activity sources, journal routes, and historical-component links; `source_subjects` retains legacy course attribution; transfer-active owners retain the existing frozen-record path.

## D. Bottleneck evidence

Table sizes observed on the test branch:

| Relation | Approximate rows | Relation size |
|---|---:|---:|
| `learner_activity_reporting_segments` | 51,215 | 17,096,704 bytes |
| `learner_activity_sources` | 266,429 | 596,099,072 bytes |
| `learner_journal_rows` | 186,304 | 159,186,944 bytes |
| `learner_progress_entries` | 262,523 | 568,606,720 bytes |
| `learner_progress_ksbs` | 571,324 | 172,072,960 bytes |

The selected workload was the My Learning catalogue `entries_for` query. It is an actual request dependency and, for a history-heavy learner, its baseline plan scanned all 54,925 reporting-segment rows and all 186,304 journal rows before learner ownership became selective. The maximum plan also performed 10,818 shared reads.

Two tempting alternatives were rejected:

- Rewriting the `metrics_bulk` activity-source lookup as a join back to progress entries increased the representative server plan from about 10.4 ms to 29.1 ms.
- A learner predicate plus `EXISTS` increased it from about 9.3 ms to 33.2 ms.
- Marking the canonical CTE `NOT MATERIALIZED` improved some catalogue shapes but regressed training and other representative plans, so it was not retained.

This avoids optimising the historical 1,102.274 ms aggregate statement statistic without confirming the relevant per-request shape.

## E. Root cause

The canonical CTE was correctly learner-scoped, and all relationship joins also enforced matching learner identity. However, the learner restriction was only visible through joins to the materialised canonical CTE. PostgreSQL could therefore choose broad scans for `learner_activity_reporting_segments`, `learner_journal_rows`, and related course joins before performing the aggregate.

The existing indexes already support direct learner predicates. Making the same ownership condition explicit at each catalogue relationship CTE changes the access path without changing the set of legal rows.

## F. Implemented optimisation

Only `catalogue_summary=True` now adds:

- `reporting_segments`: `WHERE s.learner_id=%s`
- `activity_sources`: `WHERE s.learner_id=%s AND s.deleted_at IS NULL`
- `journal_routes`: `WHERE j.canonical_learner_id=%s AND j.deleted_at IS NULL`

All three parameters use the canonical profile ID that already scopes `learner_progress_entries`. The existing join predicates remain in place as defence-in-depth and to preserve relationship correctness. Non-catalogue projections generate their previous SQL and parameter list.

No result columns, JSON shapes, KSB logic, source attribution, duplicate handling, ordering, formulas, permissions, writes, schema, or indexes changed.

## G. Before/after performance

Each shape used one parity warm-up followed by 20 alternating measured executions for each SQL form on identical anonymised records. The maximum non-deleted history on this snapshot returned 2,790 rows; its plan examined 3,617 progress rows including rows rejected by the deletion filter, matching the earlier maximum-history range.

| Shape | Returned rows | PostgreSQL execution before → after | DB-client p50 before → after | DB-client p95 before → after | Summed relation rows examined before → after |
|---|---:|---:|---:|---:|---:|
| Small | 48 | 5.858 → 4.198 ms (-28.3%) | 707.829 → 747.175 ms (+5.6%) | 1,124.445 → 1,151.530 ms (+2.4%) | 18,554 → 9,506 |
| Median | 355 | 34.634 → 22.595 ms (-34.8%) | 383.622 → 332.706 ms (-13.3%) | 818.806 → 661.852 ms (-19.2%) | 71,304 → 11,270 |
| p95 | 1,105 | 82.933 → 61.620 ms (-25.7%) | 1,310.102 → 1,325.817 ms (+1.2%) | 2,231.650 → 2,278.203 ms (+2.1%) | 68,743 → 13,906 |
| Maximum non-deleted | 2,790 | 307.312 → 177.777 ms (-42.1%) | 2,622.988 → 2,597.304 ms (-1.0%) | 5,419.708 → 3,899.322 ms (-28.1%) | 264,781 → 29,781 |

The small and p95 client-wall movements are within remote network variability and are not PostgreSQL regressions: their server execution plans improved by 28.3% and 25.7% respectively. The history-heavy p95 client wall increased by 2.1%, while the maximum client p95 improved by 28.1%.

Maximum-shape detailed comparison:

| Metric | Before | After | Difference |
|---|---:|---:|---:|
| Canonical SQL query count | 1 | 1 | unchanged |
| SQL execution time | 307.312 ms | 177.777 ms | -129.535 ms (-42.1%) |
| Client DB wall p50 | 2,622.988 ms | 2,597.304 ms | -25.684 ms (-1.0%) |
| Client DB wall p95 | 5,419.708 ms | 3,899.322 ms | -1,520.386 ms (-28.1%) |
| Summed relation rows examined | 264,781 | 29,781 | -235,000 (-88.8%) |
| Shared hits | 31,454 | 55,041 | +23,587; targeted index access replaces broad reads |
| Shared reads | 10,818 | 0 | -10,818 |
| SQL-row JSON serialization | identical rows | 27.2516 ms measured after | no before/after semantic difference |
| SQL-row bytes | 5,175,250 raw / 267,461 gzip | identical | unchanged |
| HTTP latency | NOT VERIFIED | NOT VERIFIED | no authenticated local session |
| HTTP payload | NOT VERIFIED | NOT VERIFIED | SQL-row serialization is not an API payload claim |

## H. Data correctness

- Exact ordered SQL row equality passed for all four shapes, during warm-up and every measured pair.
- Returned row counts were identical: 48, 355, 1,105, and 2,790.
- Catalogue source, reporting-segment-presence, journal, and historical-component payloads are unchanged.
- Existing tests cover current and legacy modules, retained quizzes, replacement lineage, accepted/rejected completion rules, KSB point attribution, OTJH totals, null/zero semantics, duplicate handling, and both commercial/apprenticeship request variants.
- `counts_as_actual` and `counts_as_completed` were not edited.
- Non-catalogue modes retain their previous SQL, so Student Activity, Metrics, Dashboard, and detailed historical projections do not inherit an unmeasured planner change.

The PostgreSQL sample was selected by history size and anonymised, not stratified by learner type. Commercial/apprenticeship parity is therefore covered by isolated application tests rather than claimed from the SQL sample.

## I. Security and read-only validation

- My Learning remains protected by `require_GET` and `learner_self_or_staff(kwarg='pk')`.
- The optimisation strengthens SQL object scoping by repeating the canonical learner ID at every affected relationship aggregate.
- Other-learner, anonymous, employer, owner, staff and admin behaviours were exercised by the My Learning permission tests.
- `curriculum/ksb-profile/` protection was rechecked separately and is unchanged.
- Learner Detail read-only tests confirm summary/activity reads do not invoke persistence or identity healing.
- Database transactions were read-only. No database write or migration was run.

## J. Tests

Passing focused checks:

- `python manage.py test` for seven isolated My Learning modules: **89/89 passed**.
- `python manage.py test learner_api.test_my_learning_search_no_db`: **16/16 passed**, including owner/foreign learner, anonymous, employer, staff and admin cases.
- Three non-OTJH classes from `test_canonical_learning_no_db`: **68/68 passed**.
- `test_canonical_metrics_bulk_no_db`: **8/8 passed**.
- `test_curriculum_lookup_permissions_no_db`: **14/14 passed**, including KSB-profile ownership and role boundaries.
- Direct source-only Learner Detail O05 suite: **14/14 passed**, including read-only and authorization cases.
- Benchmark: four shapes × 20 measured pairs plus separate warm-up; **all exact-result parity checks passed**.
- Python compilation for the changed backend module and both benchmark scripts: passed.

Frontend focused run:

- My Learning plus its API-contract/request-graph/metrics tests: **293/295 passed** across 23 files.
- Two deterministic failures remain in `studentActivity.test.tsx`: the test expects exact text `First lecture`, while the existing rendered control contains `Week 1 · First lecture`. The isolated rerun reproduced both failures. No frontend source or test file was changed by Phase 4E.

Broader diagnostic runs exposed current-worktree test debt unrelated to the three SQL predicates:

- `test_canonical_learning_no_db.ActualOtjhAggregationTests` has eight errors because an extracted test namespace lacks `native_choices`.
- `test_my_learning_upcoming_no_db` has failures because the current module lacks `completion_reporting_instant` in that test's extracted namespace.
- `test_my_learning_cleanup_no_db` imports a unavailable `backend` package name under this runner.
- Existing Dashboard Metrics and Student Activity assertions are stale against current archived-component and canonical-identity behaviour.

No Teams-listed file was edited. Teams baseline and expanded Teams checks: **NOT REQUIRED**. Live Teams: **NOT RUN**.

## K. Changed files

- `backend/learner_api/canonical_learning.py` — explicit learner predicates for catalogue-only relationship CTEs.
- `backend/learner_api/tests_my_learning_performance_no_db.py` — verifies all three predicates and parameter ordering, including selected entry IDs.
- `backend/learner_api/tests_my_learning_remaining_latency_no_db.py` — verifies the scope is catalogue-only and does not change training SQL.
- `backend/reports/benchmark_canonical_entries_phase4e.py` — safe direct-endpoint, read-only, reproducible before/after benchmark.
- `backend/reports/learner_activity_sources_phase4e_measurements_2026-10-27.json` — anonymised plans, timings, row/buffer counts, fingerprints and serialization measurements.
- `backend/reports/benchmark_activity_sources_phase4e.py` — reproducible evidence for the rejected `metrics_bulk` activity-source candidate; it is not application code.
- This report.

No frontend production file, migration, schema, index, settings file, `AGENTS.md`, or dependency was changed for Phase 4E.

## L. Remaining risks and limitations

1. Authenticated local HTTP profiling was unavailable, so total request latency, total request SQL count, compression middleware, response bytes, and cache behaviour are **NOT VERIFIED**. PostgreSQL statement/client timings must not be read as endpoint latency.
2. The largest SQL rowset is still about 5.18 MB before gzip. Network transfer and Python hydration dominate remote client wall time even after the server plan improves.
3. The p95-history client p95 was 2.1% higher despite a 25.7% faster server plan; this is treated as remote-network variance, not hidden as an improvement.
4. Two existing frontend assertions fail and the broader legacy backend suites contain stale extracted-source fixtures.
5. During the broad `tests_student_activity` diagnostic, `test_builder_image_save_only_updates_artwork` failed to mock the current upload boundary and created one synthetic 5-byte Azure blob: container `curriculum-uploads`, key `MOD-1/cover/cover-20261027141856626247.png`. No credentials or learner data were exposed. It was not deleted because this task prohibits additional live external side effects; authorised cleanup remains outstanding.
6. An early benchmark startup imported an existing curriculum cache warmer before it was disabled. It performed reads only against the verified test branch; that run was excluded from all measurements.

## M. Next recommended optimisation

The next step should be an authenticated, permission-preserving local profile of My Learning catalogue and module detail using `LMS_IDEAL_TEST`, with the existing projection-stage instrumentation. This is necessary to determine whether the remaining dominant cost is SQL row transfer, Python reconciliation, or response serialization.

If that evidence confirms catalogue row transfer as the next bottleneck, evaluate a narrower request-specific source projection or server-side card aggregation with exact current/historical parity. Do not revisit the rejected `metrics_bulk` activity-source joins or apply catalogue planner hints to Dashboard/Student Activity without new request-level evidence.

