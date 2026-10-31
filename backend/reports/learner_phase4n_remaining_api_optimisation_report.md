# Phase 4N — Remaining High-Cost Learner API Optimisation

Date: 2026-10-28 (Africa/Cairo)

Branch/workspace: current `fix/api-endpoints` checkout

Measurement boundary: isolated Django/service read; not HTTP, middleware or browser

## A. Verdict

**OPTIMISED AND VERIFIED** at the read-only Django/service boundary.

The default Student Activity request now uses a request-specific canonical
progress projection instead of materialising every progress/evidence/feed
column. On the preserved 357-row Reader fixture, exact response parity held for
every warm-up and measured pair. The final 20-pair run improved service median
from **889.556 ms to 735.234 ms (-17.3%)**, p95 from **1,587.637 ms to
1,186.242 ms (-25.3%)**, and peak traced allocation from **5,016,762 to
3,014,571 bytes (-39.9%)**. Query count and response bytes were unchanged.

The fixture has no owned old-LMS courses, so rich course-card performance is
covered by isolated contract tests rather than claimed as a measured rich-page
timing. No HTTP latency claim is made.

## B. Five Remaining Candidates

Requests whose dominant cost was already addressed in Phases 4D–4M were
excluded: Quiz ownership, My Learning catalogue SQL, Learner Detail prefetch,
Metrics, Dashboard Header/Weekly, and Training Plan profile reuse.

| Candidate | Endpoint | Current evidence | Initial/lazy | Expected impact | Risk |
|---|---|---|---|---|---|
| Student Activity | `GET /student-activity/{kind}/{id}/` | **Proven slow:** current safe baseline 5 queries, 889.556 ms median and 1,587.637 ms p95 on 357 progress rows; Phase 4C also recorded expensive related ledger/source statements | Initial after the Learner Summary gate on Progress; also required by unified My Learning data | High: blocks real progress/OTJH data and transfers a broad canonical rowset | Medium: historical/current lineage, totals and progress-transfer rules |
| Home summary | `GET /overview-week/{kind}/{id}/?section=home-summary` | **Not measured:** source-classified safe read; no current comparable service baseline | Initial after Learner Summary | Potentially high due Home critical path | Medium: shared date/hours/card calculations |
| Attendance summary and lectures | `GET /attendance/{kind}/{id}/?source=` and `/lectures/` | **Not measured:** source only | Attendance page initial | Potentially high for a dedicated page | High: attendance ownership/history and Teams-trigger files if changed |
| Evidence metadata lists | `GET /evidence/{kind}/{id}/` and `/historical/` | **Not measured:** metadata branches classified safe; storage/open branches excluded | Evidence initial, parallel | Medium; could carry historical metadata volume | Medium/high: must stay outside storage/SAS/download behavior |
| Review sessions/history | `GET /review-sessions/{kind}/{id}/` and `/review-history/{kind}/{id}/` | **Not measured:** source-classified safe reads | Reviews initial/lazy | Medium; potentially large imported history | Medium/high: dates, signatures and calendar relationships |

Only Student Activity had a current, reproducible, high-cost read and an
existing least-privilege Reader path. The other four remain candidates for
measurement, not assertions that they are slow.

Coverage status delta only:

| Coverage ID | Before Phase 4N | After Phase 4N |
|---|---|---|
| R16 Student Activity | MEASURED, NOT OPTIMISED (statement evidence only) | **OPTIMISED AND MEASURED** at the service boundary |

## C. Selected Endpoint and Reason

Selected endpoint:

`GET /learner_api/student-activity/{kind}/{id}/`

The Progress page starts it after `learner-summary` verifies that Student
Activity is available. My Learning's unified summary also consumes it. Unlike
the remaining unmeasured candidates, the preserved Reader fixture could safely
execute its pure read service and reproduce the broad canonical progress cost.

The route is `GET`-only and guarded by `learner_self_or_staff`. It has no
database writes and no external integration calls in the default-list branch.
Selected material/file/attempt routes are separate and were not profiled or
changed.

## D. Execution Path

```text
Progress page / My Learning unified summary
  → usePrefetchStudentActivity or useUnifiedLearningSummary
  → fetchStudentActivity (30-second learner-keyed client cache)
  → GET /learner_api/student-activity/{kind}/{id}/
  → learner_api.student_activity.student_activity
  → source_for_case_file or scoped enrolment source
  → canonical_learning.profile
  → canonical_learning.entries_for
  → learner_progress_entries + KSB/source/segment/journal/history CTEs
  → canonical_learning.source_subjects
  → replacement-hour projection and owned cover metadata
  → JsonResponse (private, no-store)
```

The request blocks the real Progress/OTJH combined data once Summary declares
the historical source available. Frontend request deduplication/caching remains
30 seconds and learner/kind scoped. The backend still returns `private,
no-store`; no cache behavior changed.

Authentication and object ownership remain in the unchanged decorator before
the view's protected reads. Query parameters cannot replace the server-resolved
learner identity. No hidden GET mutation was found in the selected branch.

## E. Current Baseline

The benchmark used the existing safe environment:

- branch `lms_ideal_test`, ID `br-orange-shadow-abm8uwwe`;
- database `neondb`;
- endpoint `ep-dawn-block-ab5vob3x`;
- role `lms_benchmark_reader`;
- `transaction_read_only=on`;
- preserved synthetic enrolment ID 1602;
- 357 non-deleted progress rows;
- the same process, connection, parameters and cache state;
- warm-up followed by 20 alternating before/after samples.

Baseline facts:

- 5 SQL queries;
- 889.556 ms service median and 1,587.637 ms p95 in the final run;
- 835.317 ms median DB-client execute time;
- 61.295 ms residual Python median;
- 0.093 ms serialization median;
- 658-byte response;
- 5,016,762 peak traced bytes;
- 357 canonical rows materialised as 1,016,272 diagnostic JSON bytes.

The Reader cannot read the KSB-exclusion registry or optional subject attempts.
Both variants therefore use the same `TRUE` exclusion predicate and absent
attempt relation inside the benchmark only. Application permissions and SQL
predicates were not weakened.

## F. Root Cause

The default Student Activity branch called `entries_for(owner)` with its broad
projection. That path selected `progress.*` and serialised evidence, feed,
audit-detail and other wide progress fields even though the response consumes
only:

- completion/timing/accepted-hours facts;
- module/component/group display identity;
- KSB codes;
- source, historical and journal lineage;
- course display placement and reconciliation metadata.

The 357 live progress table rows totalled 876,078 bytes as full row JSON in a
separate read-only diagnostic. After joins/aggregates, the benchmark's
canonical Python result was 1,016,272 JSON bytes even though the final response
was only 658 bytes for the retained empty-course shape. Query count was not the
problem; excessive database materialisation, transfer and Python decoding were.

An exploratory `dashboard_metadata` projection was rejected. It still began
with `progress.*`, did not materially narrow the wide row, increased peak
allocation, and produced an unstable p95. Only the explicit-column projection
was retained.

## G. Exact Code Changes

- `backend/learner_api/canonical_learning.py`
  - adds the internal `student_activity_summary=True` projection;
  - reuses the existing completion/timing/lineage projection;
  - explicitly retains `group_ref` and `group_title` for the OTJH card fallback;
  - retains KSB, source, journal, historical, display-placement and
    reconciliation facts;
  - omits unrelated wide evidence/feed/audit-detail progress columns;
  - leaves every other `entries_for` mode unchanged.
- `backend/learner_api/student_activity.py`
  - requests the new projection only for the default Student Activity list;
  - continues to pass the same prepared records to course catalogue,
    replacement-hours and ledger output functions.
- Focused tests assert the endpoint uses one compact ledger read, required
  group/display/lineage fields remain in SQL, and the complete ledger continues
  into replacement-hours and `include_ledger=True` output.
- `backend/reports/benchmark_learner_student_activity_phase4n.py`
  - reproduces the current and compact services with pinned Reader identity,
    parity checks, 20 alternating samples, query/CPU/memory/serialization and
    materialisation diagnostics.

No frontend production file, public endpoint, serializer contract, model,
schema, migration, data or dependency changed.

## H. Response Parity

Warm-up and every measured pair produced exact Python payload equality. There
was no timestamp exclusion or semantic exception. Final JSON remained 658
bytes.

Preserved behavior includes:

- exact keys, types, nulls, numbers, rounding and order;
- course/activity placement and group-title fallback;
- accepted OTJH totals, ledger activities, KSB codes and replacement hours;
- current/historical duplicate reconciliation and progress-transfer handling;
- soft-delete filtering (`progress.deleted_at IS NULL`);
- date/time-zone allocation and completion instants;
- anonymous and cross-Learner denial;
- retryable database errors and existing status/message contracts;
- no database writes, external calls or additional queries.

The no-database source/OTJH suites cover empty, single, multi-record,
duplicate/historical, null/decimal, ordering, date allocation, missing
relations and rich catalogue shapes. The benchmark covers the deterministic
357-row shape and verifies query count does not grow with that population.

## I. Before vs After Performance

Final run, 20 alternating samples per variant:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Query count | 5 | 5 | unchanged |
| Service median | 889.556 ms | 735.234 ms | **-154.322 ms (-17.3%)** |
| Service p95 | 1,587.637 ms | 1,186.242 ms | **-401.395 ms (-25.3%)** |
| DB-client execute median | 835.317 ms | 684.630 ms | **-150.687 ms (-18.0%)** |
| Python median | 61.295 ms | 50.455 ms | **-10.840 ms (-17.7%)** |
| Python p95 | 65.594 ms | 53.670 ms | **-11.924 ms (-18.2%)** |
| Process CPU median | 109.375 ms | 62.500 ms | **-46.875 ms (-42.9%)** |
| Serialization median | 0.093 ms | 0.092 ms | effectively unchanged |
| Payload bytes | 658 | 658 | unchanged |
| Peak traced allocation | 5,016,762 B | 3,014,571 B | **-2,002,191 B (-39.9%)** |
| Canonical result rows | 357 | 357 | unchanged |
| Canonical diagnostic JSON | 1,016,272 B | 524,077 B | **-492,195 B (-48.4%)** |
| Errors / timeouts | 0 / 0 | 0 / 0 | unchanged |

The final SQL plan examined the same 357 progress rows. PostgreSQL execution
increased from 11.842 to 18.157 ms because it constructs the explicit compact
JSON projection, while the much larger remote transfer/decode reduction lowered
DB-client, Python, CPU, memory, median and p95. This trade-off is retained and
reported.

A second final-code run also improved median (1,237.009 → 1,155.027 ms), p95
(2,374.501 → 1,557.621 ms), Python time and memory. Remote Neon variability is
therefore visible, but both repetitions agreed on direction. These remain
service measurements, not HTTP percentiles.

## J. Backend Tests

- Student Activity endpoint/data suite: **PASS — 36/36**.
- Seven My Learning isolated suites: **PASS — 89/89**.
- My Learning search plus the three non-OTJH canonical classes: **PASS — 85/85**.
- Focused replacement-hours endpoint snapshot: **PASS — 1/1** for both learner
  kinds within the parametrised test.
- Phase 4K Metrics plus Phase 4L Weekly regressions: **PASS — 95/95**.
- Phase 4M identity/training plus relevant Coach regressions: **PASS — 123/123**.
- Reader benchmark: **PASS** in repeated final-code runs; exact parity, 20
  alternating samples per variant, zero error/timeout.

The full canonical no-database module ran **76 passed / 8 errors**. All eight
errors are the documented extracted-test namespace problem where
`current_learning.project_current` cannot resolve `native_choices`; none enters
the Phase 4N projection test, which passed.

A broader 81-test diagnostic also exposed existing stale Subject Source and
Replacement Hours fixtures plus SimpleTestCase database-access errors. The one
endpoint assertion affected by Phase 4N was updated and passes independently;
unrelated failures were not suppressed.

## K. Frontend Tests

```text
npm --prefix frontend run test --
  src/hooks/__tests__/learnerNavigation.test.tsx
  src/api/__tests__/learnerRead.test.ts
  src/pages/learner/my-learning/studentActivity.test.tsx --maxWorkers=2
```

Result: **93 passed / 2 failed**. Both failures are the already documented
Student Activity display assertions expecting exact `First lecture` text while
the current control renders `Week 1 · First lecture`. The API/cache/navigation
files passed and Phase 4N changed no frontend source.

The broad Learner Pages diagnostic produced **94 passed / 20 failed**. The
failures are in existing UI/date/request fixture expectations outside the
changed backend projection; the run is reported, not relabelled as a pass.

TypeScript was not rerun because no frontend file changed and the repository
records the check as blocked/timed out.

## L. Shared Coach Regression Tests

The new mode is used only by the shared Student Activity endpoint; Coach case
file projections keep their existing modes. Relevant Coach overview/module/
learning-plan suites passed **41/41**, included in the 123-test combined run.
The Phase 4L Coach/Learner Weekly regressions also passed in the 95-test run.

## M. Known Unrelated Failures

- `learnerContentLoading`: documented baseline 5 failed / 2 passed; not rerun
  because no frontend loading implementation changed.
- Training Plan full suite: documented baseline 1 failure / 1 error; Phase 4N
  did not touch that route.
- Canonical extracted-source tests: 8 `native_choices` namespace errors.
- Student Activity frontend: 2 exact-label assertions (`First lecture` versus
  the current prefixed label).
- Broad Learner Pages: 20 current UI/date/request fixture failures; no Phase 4N
  frontend file participates.
- TypeScript: previously blocked/timed out and not claimed as passing.

## N. Remaining Bottleneck Backlog

1. Rich Student Activity still lacks a Reader-accessible fixture with owned
   old-LMS courses, catalogue cards, KSBs, covers and ledger activities.
2. The canonical query still examines every live learner progress row and its
   source/segment/journal/history relationships; Phase 4N narrows columns, not
   row population or business reconciliation.
3. Home `home-summary` remains the highest-priority unmeasured initial request.
4. Attendance summary/lectures, Evidence metadata and Review sessions/history
   remain unmeasured; their write/storage/calendar neighbors must stay excluded.
5. My Learning's maximum-history residual transfer/decode cost remains high,
   but its dominant SQL was already materially optimised in Phase 4E.

## O. Recommended Next Request

Measure **Home `GET /overview-week/{kind}/{id}/?section=home-summary`** next.
It is an initial request outside the already optimised paths, is source-classed
as a read-only projection, and currently has no comparable baseline. Profile it
before editing, separating canonical metrics reuse, plan/card reads, Python
aggregation and response bytes. If it is not materially expensive, move to the
metadata-only Evidence pair rather than speculating on Attendance/Calendar.

## P. Safety Confirmation

- No Production or parent `lms-ideal-architecture` access.
- Only pinned `lms_ideal_test` / `br-orange-shadow-abm8uwwe` / `neondb` with
  `lms_benchmark_reader` and `transaction_read_only=on` was measured.
- No owner credentials, database writes, schema changes, migrations, learner
  mutation, fixture mutation or cleanup.
- No Graph, Teams, Azure, SMTP, storage or other external integration call.
- No Teams trigger file edited; Teams baseline and expanded Teams checks are
  **NOT REQUIRED**. Live Teams was not run.
- No public API, UI/UX, formula, rounding, ordering, null, date/time-zone,
  permission, soft-delete or progress-transfer behavior changed.
- Previous Phase 4D–4M optimisations and unrelated staged/unstaged changes were
  preserved.
- No branch/worktree creation or switch, no commit and no push.
- No HTTP improvement is claimed.
