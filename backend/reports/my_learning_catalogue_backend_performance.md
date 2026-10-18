# My Learning catalogue backend performance

Implemented in the current working folder on `coach_view`. Every pre-existing change was preserved. No branch creation/switch, commits, merges, migrations, schema changes, deployment, production database connection, database writes or direct production SQL profiling occurred.

The user's Chrome observation was approximately 20.46 seconds / 19 KB for learner 265, with 8 modules and 1,596 activities. It is an observation supplied with the request, not a new measurement. This implementation removes backend work before serialization. The under-five-second HTTP objective remains unverified.

## Bottlenecks found through source inspection

1. `current_learning.merge_attempts` scanned the entire growing canonical record set for every historical attempt. Each scan re-decoded original-source lineage and re-walked source/historical links: O(attempts ? records ? links).
2. Catalogue `load_context` called `dashboard_training.module_rows`, which always invokes `attach_curriculum_slots`. That fetches cohort holidays and constructs every module's holiday-adjusted slots, outcomes and holiday notes. The compact catalogue consumes stored dates and educational-session counts, not those slot objects. `read_builder_activity_dates` separately calculates the delivery dates actually required by previews/deadlines, so the first scheduling pass was redundant.
3. Catalogue `entries_for(..., monthly_summary=True)` aggregated KSB rows/exclusion predicates and full segment/historical-component JSON. The catalogue needs canonical accepted seconds, completion and source routes, plus segment presence for direct-save deduplication; it does not consume KSB metrics or history bodies.
4. `_append_week_quizzes` re-read assigned module titles/programme scope already fetched by catalogue metadata. Native identity reads also queried normalized quiz links even when there was no `type='quiz'` component. `read_live_credits` then queried live components already present in the native identity read.
5. Each replacement successor rebuilt/re-attributed the complete programme record population and calculated every module's progress. A final complete projection ran again for ordinary cards.
6. `catalogue_display_context` parsed the same historical section's dates for every exported material and repeatedly calculated the earliest dated-section order.
7. Initial upcoming selection sorted a materialized list of every eligible deadline even though it returns at most three links. Session candidates were already SQL-bounded; that bound was retained.

These are demonstrated source-level costs, not measured shares of the actual learner's 20.46-second request.

## Implementation and reads removed/narrowed

- Added `my_learning.catalogue_module_rows`: two batched SELECTs for card/module scope and visible week/session counts. It omits the groups join, descriptions, coach metadata, holiday-note/outcome payloads and timetable construction. Stored dates, visibility, educational-session exclusions and card fields use the same existing helpers/rules. `dashboard_training.module_rows` remains intact for focused module detail and other consumers.
- Added the opt-in `canonical_learning.entries_for(catalogue_summary=True)` projection. It omits the KSB CTE/join and its registry check, keeps only segment IDs and historical source-system/course/activity identities, and narrows object source payloads to `original_source_ref` inside the CTE before serializing the row. Explicit accepted seconds, original journal routes, deleted-row/owner predicates and learner-wide reconciliation remain. Encoded/nonobject legacy payloads retain their existing handling. Default/shared reporting projections retain their prior fields.
- Removed two unused repeated historical-definition columns: activity type and course title. The owned course table already supplies card titles; typed source identity remains authoritative. Completion/status/accepted seconds are computed once per canonical record and reused across its placements, with hours still counted once per course.
- Indexed historical attempt routes by record position across original references, explicit old-LMS material links and historical component links. Matching preserves input order, material-versus-quiz identity, multiple matched records, score maxima, synthetic attempt records and repeated attempts; source records are not mutated and completion never creates accepted hours.
- Extracted `training_plan_dashboard.module_record_index` from the canonical module projector. The catalogue builds it once and reuses it. Each replacement uses the original-order union of its current records and exact predecessor record IDs. The existing projector performs the final sum/rounding; rounded per-course totals are not added, and overlapping historical/current records are counted once in each intended successor.
- Passed request-local `quiz_modules` through Weekly to `_append_week_quizzes`, removing its duplicate module-scope SELECT. Published-week, explicit-course-link and legacy title/programme matching remain unchanged. Empty normalized quiz-link queries are skipped only on the catalogue path when SQL's exact quiz-type predicate cannot match a component.
- Captured raw live-credit component identities during the native SELECT and passed them to the unchanged `read_live_credits` service in its existing component-ID order. Raw series/occurrence/session-number values are kept separate from display-only extra-session overrides, with PostgreSQL text extraction semantics retained. Authoritative register, attendance thresholds/corrections and live-credit supplementation still run unchanged when live components exist.
- Parsed historical section dates once per unique course/section and computed earliest dated order once per course.
- Used a bounded heap for initial upcoming selection. Eligible assignment/checkpoint facts stream from existing component/completion/date facts; no all-deadlines list is retained. SQL still fetches at most four future session candidates, and the final `(date, id)` ordering, UK instants and existing action links are unchanged. On-demand expansion can still return all minimal links.

No persistent cache, duplicate frontend request or changed progress/OTJH business rule was introduced. Programme actual remains the accepted learner-wide canonical seconds total; planned hours remain the owner's overall programme plan in the journal view. The supplied 159.4861 / 576 values were not hardcoded or re-queried.

## Isolated operation counts

The checked-in offline runner compares the pre-edit source snapshot with current functions using synthetic facts and scripted SELECT readers. The large fixture has 247 native activities, 1,349 legacy activities, 1,596 canonical records and 1,349 historical attempts. This attempt count is synthetic; the real learner's attempt count is unknown.

| Operation / fixture | Before | After |
| --- | ---: | ---: |
| Original-source resolutions during attempt merge | 2,153,004 | 1,596 |
| Module-attribution index builds, four replacement successors | 5 | 1 |
| Records visited by those attribution builds | 7,980 | 1,596 |
| Section schedule parses, 1,349 materials in one section | 1,349 | 1 |
| Published-quiz SELECTs, assigned module/no published quiz fixture | 4 | 3 |
| Native identity SELECTs, one live component/no quiz fixture | 2 | 1 |
| Additional live-credit component SELECTs, same fixture | 1 | 0 |
| Module-card metadata SELECTs, eight modules | 2 | 2 |
| Timetable-builder helper invocations from card metadata | 1 | 0 |
| Canonical ledger SELECTs | 1 | 1 |
| KSB exclusion-registry helper checks during ledger SQL construction | 1 | 0 |
| Full segment/historical JSON aggregation | both present | both absent |

The table reports isolated stages, not a whole-endpoint PostgreSQL query count. The timetable helper was mocked for its operation comparison; internal holiday SQL savings are source-derived and are not assigned a fabricated measured count. A registry check may require a cold optional-table SELECT; that production round trip was not measured. Query reductions depend on the learner's actual content, links and optional-table state.

## Reproducible Python CPU comparison

Command, from repository root:

```powershell
python backend/reports/benchmark_my_learning_catalogue.py --baseline-dir C:\Users\khalil\AppData\Local\Temp\lms-my-learning-perf-84080c7062a94c3baf861f3be08d523a --repeats 3
```

The baseline directory holds the pre-task source snapshot, including the prior uncommitted My Learning implementation. `course_catalogue_display.py` was unchanged at task start and was recovered from HEAD. The runner reads function ASTs, denies every database connection, disables background warming for its process, and denies socket connections after Django initializes its internal event loop. It does not run a server or query real data.

Medians of three samples using `time.process_time()`:

| Isolated stage | Before CPU ms | After CPU ms |
| --- | ---: | ---: |
| Historical attempt merge | 2609.375 | 4.062 |
| Replacement-card aggregation, including fixture deepcopy | 156.250 | 140.625 |
| Historical section context | 78.125 | 31.250 |

The fast attempt path is batched 100 times per timing sample and divided by 100 to resolve Windows' coarse process CPU clock. Timings are machine/load dependent. Other operation counters run separately from timed callbacks. These stages are not an end-to-end request benchmark and should not be summed or translated into a promised HTTP duration. No SQL time, query plan or network latency is included.

Baseline SHA-256 values printed by the runner:

```text
my_learning.py              28c9b4c507191091b00d9b67cf270289c0cb3188db2f03b53f842c9df2b5549d
current_learning.py         140b2fd311399e511ede9a7a6f609ba7533eaf92ea03303106d00880018ee13e
course_catalogue_display.py c4b1a85cfe0cba7d7c328de5f6189549a337772b3c492de402cd7d4d8107982c
canonical_learning.py       e92a252b20113b7d01f9dd1cc46160086b28b285fc1cdbb136662839c97f33ee
learner_detail.py           e5426990ff63d7326f0e47de17047727b3f77a8d2c8672d1878dec17272e1322
```

## JSON and correctness parity

The offline runner asserts exact full catalogue equality against the prior implementation for large mixed and replacement fixtures, and exact historical-attempt and section-context equality. The backend-generated catalogue/native/legacy contracts still match `frontend/src/test/myLearningFixtures.json`; that fixture was not changed. Initial fields, IDs, counters, progress/status, covers, next previews, planned-versus-actual nulls, certificate eligibility, upcoming links and selected-module navigation contracts are unchanged.

The narrow ledger omits only facts unused by this catalogue. Weekly's raw progress reader is deliberately retained: reconciled canonical records can collapse native retries, so substituting them for raw quiz-attempt/failed-start/retained-slot facts would not be proven equivalent. Similarly, authoritative attendance register reads and the delivery-date planner needed by previews/deadlines are retained.

## Files/functions changed in this task

- `backend/learner_api/my_learning.py`: `catalogue_module_rows`, `course_facts`, `load_context`, replacement-hour aggregation in `assemble_cards`, bounded `upcoming_links`.
- `backend/learner_api/canonical_learning.py`: opt-in narrow `entries_for` projection. Other existing modifications were preserved.
- `backend/learner_api/current_learning.py`: indexed `merge_attempts`.
- `backend/learner_api/training_plan_dashboard.py`: shared `module_record_index` and optional reuse by `_canonical_module_progress`. Other existing changes were preserved.
- `backend/learner_api/learner_detail.py`: optional module metadata reuse in `_append_week_quizzes`; opt-in live-credit capture and empty quiz-link query suppression in `_resolve_from_master`.
- `backend/learner_api/weekly_learning.py`: forwards request-local quiz metadata.
- `backend/learner_api/course_catalogue_display.py`: section/date reuse.
- `backend/learner_api/tests_my_learning_no_db.py`: updates the existing context test for the new card reader and opt-in ledger shape, retaining its scope/ownership assertions.
- `backend/learner_api/tests_my_learning_performance_no_db.py`: large-catalogue, lineage/index, metadata/SQL narrowing, raw live identity and bounded upcoming regressions.
- `backend/reports/benchmark_my_learning_catalogue.py`: safe offline source comparison.
- This report. No frontend source or existing JSON fixture was edited in this task.

## Validation

- **195 guarded backend tests passed**, including My Learning/performance, shared Dashboard/Weekly, replacements/grouping, live-session eligibility, retained quizzes and canonical bulk metrics. Exact runner below.
- **132 isolated tests passed**, with `PYTHONPATH=backend`:
  `python -m unittest backend.learner_api.test_canonical_learning_no_db backend.learner_api.test_current_learning_no_db backend.learner_api.test_my_learning_cleanup_no_db backend.learner_api.test_course_catalogue_no_db backend.learner_api.test_course_catalogue_display_no_db backend.learner_api.test_quiz_placement_no_db backend.learner_api.test_source_completion_no_db backend.learner_api.test_programme_target_no_db`.
- **21 local-content tests passed**, separate process with `PYTHONPATH=backend`:
  `python -m unittest backend.learner_api.test_local_subject_content_no_db`.
- **508 frontend tests passed, 46 files**:
  `npm --prefix frontend run test -- src/pages/learner/my-learning src/pages/workspace/learner/__tests__ src/api/__tests__/weeklyLearningContract.test.ts src/api/__tests__/weeklyMutations.test.ts src/hooks/__tests__/useWeeklyLearning.test.tsx src/hooks/__tests__/useWeeklyLearningWeek.test.tsx src/api/__tests__/learnerRead.test.ts src/api/__tests__/learnerOverview.test.ts src/hooks/__tests__/learnerNavigation.test.tsx --maxWorkers=2`.
- `npm --prefix frontend run type-check`: **PASS**.
- `npm --prefix frontend run build`: **PASS**, 4185 modules transformed. Dependency eval/chunk-size/plugin-timing warnings emitted. No deployment.
- Frontend My Learning files already modified in the preserved working tree were linted, from frontend:
  `.\node_modules\.bin\eslint.cmd src/api/myLearning.ts src/pages/learner/my-learning/CompactModules.tsx src/pages/learner/my-learning/LearningCatalogue.tsx src/pages/learner/my-learning/learningSummary.ts src/pages/learner/my-learning/compactModules.test.tsx src/pages/learner/my-learning/studentActivity.test.tsx --report-unused-disable-directives --max-warnings 0`: **PASS**. No frontend source was changed by this latency task.
- Changed Python files parsed successfully; tracked/untracked scoped whitespace checks and `git diff --check`: **PASS**.
- Offline before/after runner: **PASS**, including exact JSON and stage-output parity assertions.
- Teams baseline/expanded checks: **NOT REQUIRED**. No listed Teams file or directly consumed function/type/response changed. Existing attendance/Teams services are called unchanged; their read-only live-credit unit suite was included as feature validation. Live Teams: **NOT RUN**.

Guarded runner (literal PowerShell here-string piped to `python -`; no database setup or migrations):

```python
import os, sys, unittest, socket
sys.path.insert(0, 'backend')
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['DJANGO_USE_SQLITE'] = 'true'
os.environ['CURRICULUM_WARM'] = '0'
from django.conf import settings
assert all(db['ENGINE'] == 'django.db.backends.sqlite3'
           for db in settings.DATABASES.values())
from unittest.mock import patch
from django.db.backends.base.base import BaseDatabaseWrapper
names = [
    'learner_api.tests_my_learning_no_db',
    'learner_api.tests_my_learning_performance_no_db',
    'learner_api.test_dashboard_training_no_db',
    'learner_api.test_dashboard_request_reuse_no_db',
    'learner_api.test_dashboard_weekly_no_db',
    'learner_api.test_weekly_optimization_no_db',
    'learner_api.test_previous_learning_groups_no_db',
    'learner_api.test_ksb_point_display_no_db',
    'learner_api.test_replacement_learning_no_db',
    'learner_api.tests_weekly_learning',
    'learner_api.tests_live_session_progress',
    'learner_api.test_retained_quiz_progress_no_db',
    'learner_api.test_canonical_metrics_bulk_no_db',
    'learner_api.test_dashboard_monthly_no_db',
    'learner_api.test_dashboard_overview_no_db',
    'learner_api.test_dashboard_tabs_no_db',
]
with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                  side_effect=AssertionError('Database access prohibited')):
    import django
    django.setup()
    with patch.object(socket.socket, 'connect',
                      side_effect=AssertionError('Network access prohibited')):
        result = unittest.TextTestRunner().run(
            unittest.defaultTestLoader.loadTestsFromNames(names))
sys.exit(not result.wasSuccessful())
```

Validation corrections: the first two large-fixture tests had a duplicate helper argument, corrected before the passing runs. One early expanded run disabled logging globally and therefore failed an existing `assertLogs` test; the final run retains logging and passes. The initial benchmark process triggered the application's background cache warmer; the database guard blocked all attempted connection/provisioning work, and its cache connection attempt failed. The corrected benchmark explicitly disables warming and denies both database and network I/O; no results from that initial run are used above. No test assertion was weakened and no application configuration/.env file was changed.

## Remaining likely database costs and acceptance limits

The ledger still performs learner-scoped source/journal/history joins needed for exact reconciliation. Historical export placement still expands the owned course's JSON sections/materials to preserve chronological next-activity rules. Published-quiz legacy title/programme fallback still has SQL predicates that may scan rows, and retained passed quizzes can require revision-history lookup. The canonical `actual_basis` compatibility expression still uses `to_jsonb(progress)` to tolerate an optional column. These need a safe PostgreSQL schema/plan inspection to assess further; no index/schema change or production EXPLAIN was attempted.

The unchanged authoritative lecture register can read broad attendance, recovery, confirmations and occurrence information. That remains a possible major cost for learners with live sessions. Skipping those rules or inventing a lightweight eligibility substitute would risk completion/hours correctness. The overlapping raw Weekly progress SELECT is retained for the retry/retained-quiz reason above. This report does not claim an application-wide absence of N+1 queries.

PostgreSQL integration and real HTTP profiling: **BLOCKED / NOT RUN**, because localhost connects to production and this request prohibits database connections. No production-connected Django server or browser workflow was started. The observed learner 265 totals, production query latency, end-to-end improvement and under-five-second target are **UNVERIFIED** after this change. Safe database-backed acceptance and review remain outstanding.
