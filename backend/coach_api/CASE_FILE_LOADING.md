# Coach Case File Attendance and Learning Plan loading

Scope: Coach Case File only. Student pages and their response contracts are unchanged. All new reads pass through the existing authenticated Coach ownership gate. No schema/data changes, PostgreSQL writes, synchronization, meeting operations, or Git commits are part of this change.

## Metrics intentionally differ

**Timeline Progress** uses `learner_api.module_progress.canonical_module_progress`, the shared Student/Coach catalogue/native percentage. **Programme Journey State** preserves the existing Coach activity states, including tutor acceptance, failed attempts, historical started flags, and empty authored weeks. These values can intentionally disagree. Never replace Journey completion with catalogue completion.

Journey initial/module/week responses share one server projection and roll-up. Its state precedence and historical status vocabulary are defined in `backend/coach_api/journey_rules.json`, also consumed by the existing Coach adapter. Existing progress eligibility remains in the shared progress rules. Database-forbidden regression tests execute the existing TypeScript Journey builder and compare every visible module/week count, percentage, status, OTJH value, component identity/title/state, and completion date with the server projection. Fixtures cover pending/accepted tutor validation, failed/previously passed quizzes, missing quiz component lineage, imported learning, duplicate components, special/undated weeks, empty weeks/modules, identically named weeks, and module ordering.

## Attendance

Old shape: `{attendance: {...learner metadata, totals, sessionHistory: [verbose rows]}}`.

New shape: `{summary: {sessions,present,absent,attendanceRate,outstandingAbsences}, sessions: [{id,title,date,status,reason}], months: [YYYY-MM], pagination: {page,pageSize,total,hasMore}}`.

Removed row fields: `source`, `sourceId`, `sessionType`, `rawStatus`, `effectiveStatus`, `startTime`, `endTime`, `module`, `coach`. Removed unrelated learner metadata, risk/late/catch-up counters, consecutive-missed and update timestamps. Canonical register eligibility, correction/recovery credit and business time zone are preserved. No catch-up settlement runs on Case File GET.

The first response contains 20 rows (maximum requested page size 100); summary and available months cover the complete eligible register. Search (title/reason), status and month filters run on the full register before pagination; filters never alter summary totals. Pagination bounds response growth for long histories. The existing table/pagination controls remain read-only.

First tab open: one GET. Page/filter selection: one GET for an uncached selection. Fresh revisit: zero GETs. Cache keys include authenticated Coach/view-as scope, learner, filters and page, with 60-second freshness. Logout clears the registered memory cache.

## Learning Plan

Old shape: `{schedule,week,hours,detail,covers,activity}` with programme-wide hydrated detail.

Initial shape: `{timeline:{periodStart,periodEnd,modules,reviews},journey:{summary,modules}}`. No week/component rows are sent initially.

Timeline modules carry `id,title,progressPercent,startDate,endDate,status`. Additional compact `weekAnchor` preserves weekly geometry; published holiday-note markers retain only their visible date/week/text/holiday tooltip facts. Reviews retain `id,date,type,title,status,invited`: title and invited are needed for the existing marker tooltip/booking-pending state. Same-day reviews share one marker with a count. No learner activity/calendar navigation or mutation action is exposed.

Journey modules carry identity/title, week/component/completed counts, state counts, integer Journey percentage, status and visible OTJH. Expand a module using `GET /coach_api/coach/case-file/<learnerId>/learning-plan/module/<moduleId>` to obtain its week summaries. Expand a week using the additional `/week/<weekId>` route to obtain only that week's compact component rows. Membership is checked against the learner's projection. Identities are canonical current/course IDs; no fuzzy title matching is introduced.

Removed initial sections: `schedule.months`, `schedule.actual`, `moduleProgress`, full schedule modules, `curriculumSlots`, `moduleLinks`, full sessions/reviews, coach metadata, `generatedAt`, full `week`, deadlines, `planSubjects`, dates/sessionTitles/activityCounts/monthlyActivities aggregates, `hours`, full `detail`, KSB mappings, covers and activity payloads. The new route does not call `read_dashboard`, the weekly plan, or `read_plan_detail`. Narrow curriculum/progress facts feed the Journey projection; the existing canonical progress service remains authoritative for timeline percentages. The existing scheduler supplies display end dates and published holiday hints without meeting synchronization. Native/historical date facts are reused within the initial request.

First tab open: one GET. First module expansion: one GET. First week expansion: one GET. Fresh module/week/tab reopens: zero GETs. Cache keys include Coach/view-as scope, learner, module/week selection; freshness is 60 seconds. Errors remain visible and retryable.

## Synthetic transport measurement

UTF-8, compact JSON, uncompressed. `coach_api.case_file_payload_benchmark.measure_payloads()` uses 46 synthetic register rows and a synthetic 18-module/108-week/1,473-component plan; it calls no database/network reader. This measures transport shape, not production payload size or server latency. The old plan fixture includes real contract field names with empty sessions/reviews/hours; it does not simulate large lesson bodies.

| Response | Old bytes | New bytes | Reduction |
| --- | ---: | ---: | ---: |
| Attendance, first 20 rows | 13,645 | 2,324 | 82.97% |
| Learning Plan, initial | 508,103 | 7,049 | 98.61% |

Selected module: 1,437 bytes; selected week: 2,654 bytes in that fixture.

## Validation and limits

Final combined-tree validation: Teams baseline passed (118 tests across 9 files); focused feature tests passed (43 tests across 7 files); isolated backend regression suites passed (35 tests). Frontend type-check, production build (3,985 modules), changed-file ESLint and `git diff --check` passed. The broader Case File run completed with 196 passed, 10 failed and 3 skipped tests. Focused tests include `useCaseFileAttendance.test.tsx`, `tabs/AttendanceTab.test.tsx`, `tabs/CaseFileLearningPlanTab.test.tsx`, `activityState.test.ts`, `canonicalJourney.test.ts`, and Case File session/page request tests. Commands: `npm --prefix frontend run test:teams`, `npm --prefix frontend run type-check`, `npm --prefix frontend run build`, and `npm --prefix frontend exec -- vitest run src/pages/coach/learner-case-file src/features/coach/case-file --root frontend --maxWorkers=2`. Changed-file lint used the installed ESLint with `--max-warnings=0`.

The broad Case File suite has ten existing failures, reproduced in an isolated HEAD snapshot: three legacy dashboard-contract request expectations; Next Session; two KSB selector expectations; three KSB layout/evidence/pagination expectations; and the OTJH target-after-refresh expectation. The snapshot also cannot import its PDF worker through the shared node_modules junction, so its page-request suite has a separate snapshot-only import failure. No assertions or baseline suites were weakened to conceal these results.

Backend synthetic checks run through `unittest` with every database alias replaced process-locally by SQLite `:memory:` before `django.setup()`, locmem cache, and `sys.argv=['check','test']` to disable startup warming. They are `SimpleTestCase` suites that forbid database access; no migration/test-database provisioner runs. Suites: `coach_api.tests_attendance_projection`, `coach_api.tests_case_file_read_only`, `coach_api.tests_learning_plan_projection`, `learner_api.tests_module_progress`. These do not validate PostgreSQL SQL execution or live Teams.

An isolated Chrome component preview used synthetic intercepted GET responses: initial/module/week expansion made exactly three requests, rendered 52 weekly columns, and produced no browser errors. It did not contact an application backend or external services.

Expanded database-backed Teams suites and a browser run against an application backend are **BLOCKED / NOT RUN**: no verified isolated PostgreSQL runner was established, and this task prohibits live PostgreSQL writes. Applicable boundaries include curriculum meeting/recurrence/roster/sync-verdict suites, coach booking/failure/race/security suites, and learner attendance/calendar/schedule suites. Live Teams is **NOT RUN** and was not authorized. No deployment or acceptance readiness is claimed while these checks and the existing broad-suite failures remain unresolved.
