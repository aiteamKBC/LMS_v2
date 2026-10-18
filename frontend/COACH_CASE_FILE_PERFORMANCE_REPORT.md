# Case File request consolidation report

Scope: Coach Case File reads and their shared transport/projections. Existing working-tree edits were preserved; no commits, pushes, pulls, PRs, database changes or live Microsoft operations were performed.

## Request counts

Synthetic tests use the real Case File page, tab components, hooks and session cache with a mocked HTTP transport under React StrictMode.

| Operation | Requests |
| --- | ---: |
| Profile transport / initial profile hook | 1 (`profile`, including compact header fields) |
| First Overview open | 1 (`overview`) |
| First Monthly Focus open | 1 (`monthly-focus?month=YYYY-MM`) |
| First OTJH & KSB open | 1 (`otjh-ksb`) |
| First Attendance open | 1 (`attendance`) |
| First Learning Plan open | 1 (`learning-plan`) |
| First Reviews open | 1 (`reviews`) |
| First Assignments open | 1 (`assignments`) |
| First Enrolment Documents open | 1 (`enrolment-documents`) |
| Return to any tested tab | 0 |

The default page selects Overview immediately, so loading that visible screen makes **2 total HTTP requests: profile + Overview**. The profile itself is one request. No separate header-summary, source/section-resource fan-out, or record request is initiated by these tab consumers. If initial screen total must be exactly one including a rendered Overview, the current implementation does not meet that interpretation; rendering Overview requires its independently owned request.

KSB evidence remains an explicit cached View request to `ksbs/<code>`. Expanded assignment submissions and document actions retain explicit detail requests. Changing month loads one new month response; returning to a cached month loads none. Learning Plan module metadata comes from its owning response.

Cache keys contain coach, selected view-as/admin context, learner profile ID, section and explicit selection. Successful reads persist until invalidation; concurrent consumers share a promise, caller cancellation does not cancel another consumer, failed HTTP responses are not cached, and mutation/logout invalidation remains connected. Learner/coach/view-as changes isolate scopes.

## Backend changes

Owning section endpoints aggregate their inputs server-side. Overview has exactly `wholeProgrammeProgress` and `programmeProgress`; it sends no KSB evidence details, attendance history, reviews, assignments, learning-plan components or monthly focus payload. Assignment list rows normalize contract, submission status and marking inputs; the projection reads authored components without invoking learner-detail repair/snapshot writes. OTJH/KSB omits evidence components until View. Attendance sends the existing summary/history in one response; local filters/pagination do not issue subsection requests.

CaseFileContext reuses owned profile/source objects in plan, overview-week, attendance and activity handlers. Direct progress can reuse the owned profile. Independent readers run in up to four workers with separate Django connections and propagated source context. Identical repository SELECTs are memoized only within the request, keyed by effective SQL, parameters and database alias, with copied results and write invalidation. Synthetic assertions show two identical SELECT calls execute one repository read, distinct identities execute separately, and later requests read again. This does not prove that all semantically overlapping SQL or ORM reads have been eliminated; that broader claim requires PostgreSQL query tracing and remains unverified.

Canonical OTJH, target/planned-hours, KSB, attendance and review services remain the calculation owners. Programme chart subject grouping retains verified module-link merging, activity percentages and measure availability. Learner dates and programme bounds remain distinct. Learning Plan receives its component journey and stored quiz scores within the owning response, selecting progress fields and prefetching KSB links without per-row reads. No historical data is rewritten by this task.

## Required runtime measurements

The user confirmed that no verified non-production PostgreSQL environment or synthetic learner is available and prohibited production/unverified benchmarking. No server/browser workflows were run against learner data. GET readers can have existing repair/catch-up side effects, so they were not used for benchmarking.

| Tab | Old/new payload bytes | Old/new DB query counts | Slowest actual backend stage |
| --- | --- | --- | --- |
| Profile | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Overview | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Monthly Focus | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| OTJH & KSB | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Attendance | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Learning Plan | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Reviews | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Assignments | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |
| Enrolment Documents | BLOCKED / BLOCKED | BLOCKED / BLOCKED | BLOCKED |

Every remaining actual request above 2 seconds: **UNKNOWN / BLOCKED**, not zero. The previously observed 7?13 second requests cannot be remeasured safely. Synthetic fixture bytes/timings and zero-query mocks are not presented as runtime improvements.

Instrumentation exposes `Server-Timing` and `X-DB-Query-Count`; logs section duration, payload bytes and aggregate query count across main/worker connections; warns for each instrumented stage above 500 ms and section request above 2 seconds. Identity/source and aggregate readers have stage timings. Query counts cover the section body; the outer authentication decorator executes before this measurement.

## Repeated record audit

`performanceDiagnostics.ts` sends opt-in samples asynchronously, guards against resending a sample, and does not await recording to render a page. `activityTrail.ts` is an audit stream: it batches actions, clears its queue before posting, deduplicates the same active page and sends asynchronously/with keepalive. These are distinct purposes; audit records were not suppressed. Existing diagnostic/audit tests passed. Production initiator attribution and observed repeated record counts remain unmeasured.

## Validation

- Frontend Teams baseline before edits: PASS, 9 files / 118 tests.
- Final frontend Teams baseline: PASS, 9 files / 118 tests (`npm --prefix frontend run test:teams`).
- Focused feature/real-page request/cache/timeline/assignment/diagnostics/audit tests: PASS, 14 files / 223 tests. Command: `npm --prefix frontend run test -- src/features/coach/case-file src/pages/coach/learner-case-file/learnerCaseFileLayout.test.tsx src/pages/coach/learner-case-file/components/AssignmentsTab.test.tsx src/pages/learner/training-plan-timeline src/lib/__tests__/performanceDiagnostics.test.ts src/lib/__tests__/activityTrail.test.ts --maxWorkers=2`.
- Isolated Case File backend tests: PASS, 19 tests. `backend/.venv/Scripts/python.exe backend/manage.py test coach_api.tests_case_file_transport --settings=config.settings_sqlite_test --testrunner=django.test.runner.DiscoverRunner --noinput`. SQLite-only settings inspected; these SimpleTestCase tests forbid database access and mock sources.
- Expanded isolated backend regression command: 155 tests, 154 passed / 1 failed. Labels: `coach_api.tests_case_file_transport coach_api.tests_errors curriculum_api.tests.TeamsMultiDayRecurrenceTests curriculum_api.tests.TeamsAttendanceRosterTests learner_api.tests_dashboard_metrics learner_api.tests_attendance_lectures learner_api.tests_booking_calendar learner_api.tests_cohort_schedule`, same verified SQLite settings/DiscoverRunner. Failure: `BookingEndpointRestrictionTests.test_every_coach_session_type_is_rejected_on_a_weekend`, expected weekend text, received missing-case-owner text. No assertion was weakened. A mocked Graph-error test also logs a caught forbidden DB attempt; SimpleTestCase prevents access.
- PostgreSQL-dependent Teams meeting/calendar sync/race/security checks: BLOCKED, no verified isolated PostgreSQL/schema fixture target.
- Build: PASS (`npm --prefix frontend run build`), 23.41 seconds; Vite reports existing chunk/plugin timing warnings.
- Lint: FAIL (`npm --prefix frontend run lint`), 32 errors / 146 warnings across the repository. No lint diagnostic points to the new Case File code or changed TrainingPlanDetails code; no assertions/config were suppressed. A pre-edit repository lint baseline was not captured, so these failures are not labelled pre-existing.
- Broader frontend feature run: 23 files, 196 passed / 7 failed / 3 skipped (206 tests). Command: `npm --prefix frontend run test -- src/pages/coach/learner-case-file src/pages/learner/monthly-submission src/pages/workspace/learner/useDashboardPlan.test.ts --maxWorkers=2`. Failures: three legacy request characterization assertions expecting the former contract dependency; one legacy Next Session transport assertion; two KSB selector expectations; one monthly-submission month-selection expectation. These are outstanding failures, not silently changed business rules or claimed passing checks.
- Typecheck: PASS (`npm --prefix frontend run type-check`).
- Live Teams: NOT RUN; no live external effects authorized.

Mandatory PostgreSQL checks and real performance measurements remain unresolved. This report does not claim production acceptance or a proven sub-2-second latency target.
