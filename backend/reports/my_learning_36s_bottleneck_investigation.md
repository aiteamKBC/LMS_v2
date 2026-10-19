# My Learning: 36-second bottleneck investigation and stage instrumentation

Implemented in the current working folder on `coach_view`, preserving all existing modified and untracked work. No branches, commits, merges, migrations, schema/settings changes, deployments, database writes, database connections or authenticated benchmark requests were performed.

The supplied browser evidence is 36.25 seconds total, 36.24 seconds TTFB, about 2 ms download, approximately 1.9 KB transferred, HTTP 200. The earlier 20.46-second observation is not a controlled comparison. Neither observation identifies the responsible stage, and the earlier synthetic attempt-merge improvement does not establish the cause of this TTFB.

**Under-five-second goal: UNVERIFIED.** The implemented deliverable is safe request-stage instrumentation plus independently justified reductions in repeated work. No new real HTTP measurement is claimed.

## Exact request path

For the initial GET, execution proceeds through these calls. Conditional branches keep their existing ownership/eligibility rules.

1. Django request middleware, then `require_GET`, the local diagnostic gate, `learner_self_or_staff` authorization and `learner_journal_view` source routing. The trace encloses the view's existing authorization wrapper; earlier middleware/worker queue time is outside its boundary.
2. `SOURCE_MODELS[kind].all_learners.only(...).get(pk=pk)` reads the enrolment source; `canonical.require_profile -> profile -> _validated_profile` reads and verifies the canonical owner/account link.
3. `read_catalogue -> load_context` installs request-local assignment caches, verifies the ORM learner profile, and resolves the effective assignment plan/preset.
4. `canonical.entries_for(catalogue_summary=True)` performs the narrow learner-wide ledger/source/journal/history SELECT. It decodes returned facts, then calls `current_records`: reflection/submission read, direct-save projection, submission merge, optional attempts-table check, grouped historical attempt read and indexed attempt merge. `progress_records_with_completion` and journal completion rules reconcile the result without rewriting data.
5. `catalogue_module_rows` batches module display/placement/provenance and visible week/session-count metadata.
6. `build_learning_content_summary` flattens the saved plan where needed, resolves visible native identities and quiz metadata, applies published-week/course/title/programme quiz placement, reads raw native progress, and resolves retained passed quizzes when required. The raw Weekly progress read remains distinct from the reconciled canonical ledger.
7. `annotate_attendance_completion` checks verified occurrence/register completion. `read_live_credits` reuses native live-component identities and calls the authoritative `lecture_register` when live components exist. That register calls combined KBC/Teams attendance readers, native occurrence reads, shared/recovery/catch-up logic, confirmations, recorded-attendance and staff corrections, followed by `project_live_credits`. Component completion supplementation uses those verified credits.
8. Owned historical memberships are read. Current module metadata resolves imported provenance, verified replacements and previous-learning groups. Selected replacement-component lineage and builder activity dates are read. The date reader preserves cohort holidays, empty weeks, rescheduled sessions and the canonical delivery planner.
9. `course_facts` reads narrow owned activity definitions and applies the canonical typed source/journal allocator, completion exclusions and once-per-course accepted hours.
10. `assemble_cards` resolves historical export placement, replacement completion, the shared module-attribution index, successor hour unions and live-credit hour top-ups, then current/previous summaries and card previews.
11. Scoped covers, programme actual/planned totals and the bounded upcoming preview are projected. Programme actual remains the accepted learner-wide ledger total; it is not a selected-week sum.
12. `JsonResponse(payload)` performs JSON serialization; existing cache headers and response handling follow. No frontend or public JSON contract changed.

A particularly relevant uncovered path is `lecture_register -> combined_attendance_rows -> kbc_attendance_rows -> fetch_kbc_attendance_rows`: it opens a direct `psycopg.connect(..., connect_timeout=10)` connection. Direct psycopg operations are outside Django's execute-wrapper hooks. The source proves this connection/read exists, not that it consumed any particular part of the 36 seconds. Attendance/recovery correctness prevents simply omitting this register.

## Diagnostics implemented

`projection_performance.py` already provided `ProjectionPerformance.stage`, `wrapper` and Django execute-wrapper collection. No standalone `projection_stage` function existed in this checkout. Added a ContextVar-backed `projection_stage` adapter and a local collector that reuses the existing wrapper hook. The prior measurement/logging behavior for other projections remains unchanged.

Detailed diagnostics are **disabled by default**. All of these are required to enable them:

- Process environment `LMS_MY_LEARNING_TRACE=1`.
- Existing local `settings.DEBUG=True`.
- A Django `runserver` process.
- Both the serving hostname and HTTP host are localhost/127.0.0.1/::1, and the peer is loopback.
- The initial catalogue route, not module detail, activity search or upcoming expansion.

Request parameters/headers cannot enable tracing. The gate does not connect to a database, alter database settings, install SQL debug logging, or issue a diagnostic query. Production gunicorn processes and nonlocal requests remain uninstrumented even if the flag is mistakenly present.

One bounded `projection_stage` log event is emitted per traced request. It contains only a validated UUID request correlation ID and timing/counter data. No learner IDs/names, emails, URLs, SQL text, parameters, tokens, passwords, response bodies or exception messages are retained by the collector. Stage names come from a fixed 31-name set; unknown labels aggregate under `other`. Alias buckets are bounded to configured Django aliases with an overflow bucket. Context and wrappers are restored on success and failure.

### Instrumented stage names

| Stage | Work observed |
| --- | --- |
| `dispatch` | View authorization and exclusive work outside the named child stages |
| `source`, `owner`, `profile` | Enrolment source, verified canonical owner and ORM profile |
| `assignments` | Effective assignment/preset resolution |
| `ledger` | Ledger decoding and other work outside its child stages |
| `ledger_read` | Canonical ledger SELECT, result fetch and client decoding |
| `ledger_reconcile` | Current submissions, native-save projection and historical attempts |
| `ledger_completion` | Final canonical/source completion reconciliation |
| `module_metadata` | Batched module/week/card metadata |
| `native_learning` | Native summary work outside its child stages |
| `native_content`, `native_quizzes`, `native_progress`, `retained_quizzes` | Native identity reads, published quiz placement, raw progress and earned-slot retention |
| `attendance_completion` | Verified attendance completion |
| `live_credits` | Authoritative attendance/lecture register and credit projection |
| `memberships`, `subject_metadata` | Owned source courses, import/replacement/grouping metadata |
| `replacement_settings` | Scoped replacement lineage keys |
| `activity_dates` | Builder scheduling, cohort holidays and activity dates |
| `historical_facts`, `historical_placements` | Owned activity aggregation and retained export placement |
| `replacement_reconcile` | Replacement completion and successor unions |
| `card_aggregation`, `module_hours` | Remaining card aggregation and base/live module hours |
| `covers`, `programme_hours`, `upcoming` | Cover read, overall totals and bounded navigation preview |
| `serialize` | JSON serialization |

Stage durations and CPU values are **exclusive of nested stages**, avoiding double-counting. Repeated uses of a stage aggregate locally. Request total is measured separately and includes wrapper setup/teardown; small differences from the stage sum are expected. `serialization_ms` repeats the serialization stage value for convenience and must not be added to the total again. Early error/authorization responses that do not reach the serialization stage report serialization as UNMEASURED.

Each stage reports:

- `elapsed_ms`: exclusive wall time.
- `database[]`: configured Django alias, execute-callback `sql_calls` and `client_execute_ms`. These are Django driver calls, not a universal count of every database operation in the application.
- `processing_cpu_ms`: thread CPU outside wrapped execute callbacks. It includes Python and C-extension processing, such as client-side row decoding; it is not an exact pure-interpreter profile or elapsed wall time.
- `unattributed_wall_ms`: wall time remaining after wrapped execute time and observed processing CPU. This can include connection acquisition, fetch waits, direct psycopg I/O, cache waits, thread scheduling and other unwrapped work. It is not labelled SQL server execution or Python processing.
- `connection_acquisition_ms: "UNMEASURED"` and `postgresql_server_execution_ms: "UNMEASURED"`.

Django execute callbacks run after cursor acquisition and do not encompass every `fetchall`. There is no safe existing request-local hook for separating all connection/pool wait paths here, particularly direct psycopg connections. No global driver/connection monkeypatch was added to production code. A slow `live_credits` stage with little Django execute time identifies an area for the next investigation; it does not prove a slow PostgreSQL query. Server execution requires separately authorized server diagnostics/plans.

## Independently safe work removed

1. **One repeated module import-provenance SELECT removed from the catalogue path.** The initial module SELECT now also reads `source_type` and `source_id`. Request-local import facts use the same extracted `imported_course_links` rule as the existing reader: effective assigned module identity, mba-legacy provenance, ASCII numeric source ID and positive normalized course ID. Ownership is still independently required before suppressing a native alias. Other readers retain their existing SQL behavior.
2. **Repeated full-ledger scans during live module-hour supplementation removed.** Previously each eligible unique credit filtered every canonical record. Now relevant component seconds and staff-correction markers are indexed in one pass, only when there are eligible credits. Duplicate-credit suppression, accepted-seconds rules, manual corrections, supplementation order and rounding remain unchanged. No additional SQL is introduced.
3. **Replacement settings SELECT narrowed.** It is now limited by both verified replacement module IDs and the already-loaded global native/retained component IDs. Object `legacySettings` transfers only `sourceLessonId` and `sourceMaterialKey`, the two keys the canonical replacement matcher consumes. Encoded/nonobject legacy values retain the prior fallback semantics. No lesson/evidence bodies or unrelated authored component settings are needed for this match.

These are source-level unnecessary operations, confirmed by isolated tests. They are not claimed to explain or eliminate the measured 36-second TTFB. Canonical learner verification, source exclusions, replacement ambiguity checks, all native retries, attendance/recovery rules and accepted-hour attribution remain authoritative.

## Fixture correctness and instrumentation cost

- The backend-generated catalogue/native/legacy JSON still exactly matches the unchanged shared fixture. Existing current-only, legacy-only, mixed, commercial/apprenticeship, large historical, replacement, passed/failed/retained quiz, source exclusion and hour-attribution tests pass.
- An enabled/disabled endpoint comparison preserves **identical response bytes and identical three mocked reader/SQL calls**. It exercises the real diagnostic and existing authorization decorators with synthetic source readers. Instrumentation itself adds no query or HTTP request.
- Disabled-path tests prove there are **no timer calls, SQL wrapper installation or diagnostic log events**. The inactive `projection_stage` helper returns a null context.
- The live-hour fixture visits three records once for multiple credits, preserves staff corrections and duplicate suppression, and performs zero record visits for no credits.
- Metadata tests prove the cached import reader is not queried again and replacement SQL is bounded by the existing component IDs while retaining the encoded-value fallback.
- Deterministic-clock tests verify exclusive nested stage accounting, execute/CPU separation and explicit unmeasured fields. Privacy, bounded stage names, request isolation, failed-request cleanup and local/default/production gates are covered.

An isolated final-state collector check used 12 empty stages per mocked request, 5,000 iterations per sample, median of three samples with `time.process_time()`: **0.0094 ms disabled; 0.1437 ms enabled**. The gate, connection list and log sink were mocked; no database or network calls occurred. This measures collector CPU only, excludes actual file/console log I/O and SQL-wrapper driver overhead, and is not HTTP performance evidence. There are no benchmark loops in application request code.

## Validation

- **208 guarded backend tests passed**: My Learning, new diagnostics/performance, shared Dashboard/Weekly, replacements/grouping, live attendance/credit, retained quizzes, canonical bulk metrics and existing projection-performance tests. Exact runner below.
- **140 isolated tests passed**, with `PYTHONPATH=backend` and `CURRICULUM_WARM=0`:
  `python -m unittest backend.learner_api.test_canonical_learning_no_db backend.learner_api.test_current_learning_no_db backend.learner_api.test_my_learning_cleanup_no_db backend.learner_api.test_course_catalogue_no_db backend.learner_api.test_course_catalogue_display_no_db backend.learner_api.test_quiz_placement_no_db backend.learner_api.test_source_completion_no_db backend.learner_api.test_programme_target_no_db backend.learner_api.test_subject_origins_no_db`.
- **21 local-content tests passed**, separate process with `PYTHONPATH=backend`:
  `python -m unittest backend.learner_api.test_local_subject_content_no_db`.
- **508 frontend tests passed, 46 files**:
  `npm --prefix frontend run test -- src/pages/learner/my-learning src/pages/workspace/learner/__tests__ src/api/__tests__/weeklyLearningContract.test.ts src/api/__tests__/weeklyMutations.test.ts src/hooks/__tests__/useWeeklyLearning.test.tsx src/hooks/__tests__/useWeeklyLearningWeek.test.tsx src/api/__tests__/learnerRead.test.ts src/api/__tests__/learnerOverview.test.ts src/hooks/__tests__/learnerNavigation.test.tsx --maxWorkers=2`.
- `npm --prefix frontend run type-check`: **PASS**.
- `npm --prefix frontend run build`: **PASS**, 4185 modules transformed; dependency eval/chunk-size/plugin-timing warnings emitted.
- Preserved My Learning TS/TSX files linted from frontend with:
  `.\node_modules\.bin\eslint.cmd src/api/myLearning.ts src/pages/learner/my-learning/CompactModules.tsx src/pages/learner/my-learning/LearningCatalogue.tsx src/pages/learner/my-learning/learningSummary.ts src/pages/learner/my-learning/compactModules.test.tsx src/pages/learner/my-learning/studentActivity.test.tsx --report-unused-disable-directives --max-warnings 0`: **PASS**.
- Changed Python parse/scoped whitespace and `git diff --check`: **PASS**.
- Teams baseline and expanded Teams checks: **NOT REQUIRED**. No listed Teams file or directly consumed function/type/response changed; existing meeting and attendance rules/services remain. The relevant live-credit unit suite ran as feature validation. Live Teams: **NOT RUN**.
- PostgreSQL integration, actual request trace and HTTP performance: **NOT RUN**. No production-connected server or browser workflow was started by the agent.

Guarded runner, executed via a literal PowerShell here-string piped to `python -`:

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
    'learner_api.tests_my_learning_diagnostics_no_db',
    'learner_api.test_projection_performance_no_db',
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

## Capture one ordinary authorized request after review

These are instructions for the user after reviewing the instrumentation. They were **not executed** by the agent.

1. Use the existing local development checkout and usual authorized account. Stop the existing local backend before restarting it; do not start a second backend, deploy, migrate or change database credentials/settings. The development session must already have DEBUG enabled. The diagnostic gate intentionally refuses production server processes.
2. In that backend terminal, from the repository root, opt in for this local process and suppress background curriculum warming:

   ```powershell
   $env:LMS_MY_LEARNING_TRACE = '1'
   $env:CURRICULUM_WARM = '0'
   Set-Location backend
   python manage.py runserver 127.0.0.1:8000 --noreload
   ```

   Use the backend's existing port instead of 8000 if the frontend is configured for another port. Leave all database/auth settings as they are. No SQL debug logging, profiling endpoint, EXPLAIN, benchmark loop or extra diagnostic query is needed.
3. Make **one ordinary My Learning page load** in the existing authenticated local frontend. Match the catalogue response's existing `X-Request-ID` header to the terminal's single `projection_stage` event. Capture that event and the DevTools timing for that same request. Do not repeatedly reload to benchmark, and do not copy SQL logs, cookies, request headers/tokens or response learner data.
4. Stop the diagnostic backend after capturing the event. Remove the temporary opt-in before starting the backend normally again:

   ```powershell
   Remove-Item Env:\LMS_MY_LEARNING_TRACE -ErrorAction SilentlyContinue
   ```

   Restore the prior `CURRICULUM_WARM` value if this terminal previously set one. These process-local variables do not edit `.env` or production settings.
5. Compare the largest exclusive stage times with the request total. High `client_execute_ms` identifies Django client SQL time, not PostgreSQL server time. High `processing_cpu_ms` identifies CPU-heavy processing. High `unattributed_wall_ms` requires distinguishing acquisition/fetch/direct attendance/cache/scheduling waits before choosing another fix. If browser TTFB greatly exceeds the trace total, investigate work before the trace boundary, including middleware/worker/proxy queuing.

A missing trace means the local gate was not satisfied; do not weaken its production/local checks to force logging. The required next evidence is the bounded stage event from the authorized ordinary load, not another synthetic performance claim.

## Files changed and remaining limits

This task changed `projection_performance.py`, `my_learning.py`, `canonical_learning.py`, `weekly_learning.py`, `subject_origins.py`, `live_session_progress.py`, the existing My Learning context/performance tests, and added `tests_my_learning_diagnostics_no_db.py` plus this report. Earlier work and reports remain intact. No frontend source, public fixture, authentication gate, meeting code or database configuration was changed.

Connection/pool acquisition, raw psycopg execute/fetch time, PostgreSQL server execution, proxy/worker waiting, cold database/cache state and the real learner's stage distribution remain unmeasured. The authoritative lecture register, native quiz/revision reads, builder scheduling and canonical ledger joins remain possible costs; none is asserted to be the actual 36-second culprit without a trace.

**Under-five-second goal: UNVERIFIED.** Stage instrumentation and independent safe improvements are implemented and mock-validated; identifying and verifying the real request bottleneck still requires the reviewed ordinary-load measurements described above.
