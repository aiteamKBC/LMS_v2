# Student Dashboard Header audit — 17 October 2026

Subsequent product decision: remote curriculum tracking has now been disabled
application-wide at the user's request. The remote-refresh behavior described
in the historical Header audit below is superseded by
[the epoch-removal handoff](cache_epoch_removal_2026-10-17.md). Local-save learner
invalidation and explicit refresh are retained.

Delivery update: at the user's request, the 17 Header files were also applied to
`C:/Users/khalil/Downloads/LMS_v2` on the local `coach_view` branch. Existing
weekly-learning work was preserved; the shared learner-page test retains both
changes. No commit or push was made. The measurements below were taken in the
isolated checkout, not rerun against the combined `coach_view` working tree.

Transfer checks on `coach_view`: 54 backend tests passed. The eight focused
frontend suites produced 65 passes / 8 failures. All eight failures are in
`dashboardRequestGraph.test.tsx` and reproduce with identical test names in a
separate reconstruction of the working tree immediately before the transfer
(11 passes / 8 failures in that suite, both before and after). They concern the
existing Weekly V2 query/fixture/cache expectations, not newly introduced Header
failures. Existing unrelated modified/untracked files were checked by content
hash and remained unchanged; the shared learner-page test retains both edits.
Lint on the combined checkout reports 32 errors / 139 warnings, with no findings
in Header files, matching the earlier isolated/baseline totals.
Type-check on `coach_view` reports only the missing installed `qrcode.react`
module in `src/pages/engagement/events/page.tsx:18`, as in the isolated checkout.

Changes are uncommitted in the isolated `LMS_v2_header` checkout on
`perf/student-header-v2-current-20261017`, based on GitHub main `5a7596bb5`.
The original `LMS_v2` checkout and its weekly-learning changes were preserved.
No database writes, migrations, commits, pushes, merges, or deployments were performed.

## Findings and measurements

The existing Header was already a dedicated projection with narrow enrolment
fields and one item per upcoming card. Payload size was not the principal cost.
The assignment deadline helper loaded 3,357 / 1,287 component scheduling rows
for the sampled learners, even though only 56 / 16 deadline-bearing assignments
were needed. Those reads took about 1.6 / 2.0 seconds in the first paired run's
warm samples. It also read assignment progress before discarding assignments
without an authored deadline rule. The Header resolved the same consolidated
profile twice and counted every authored week only to test whether any existed.

Final paired PostgreSQL measurements use two active commercial learners,
three runs per variant, alternating baseline/optimized order, with a fixed
`now` within the experiment. All database aliases have read-only startup
settings; `default` and `enrolment` were opened and verified read-only. Execute
wrappers cover every configured alias. External HTTP calls were forbidden and
caches were process-local. No learner identities, payloads or SQL parameters
are saved. These timings include projection construction and serialization;
they exclude HTTP transport, authentication, middleware and browser rendering.

| Metric | Before | After |
| --- | ---: | ---: |
| Median projection duration, all six reads per variant | 5,399.32 ms | 3,253.77 ms |
| Median database-call time, all six reads per variant | 5,032.09 ms | 3,157.07 ms |
| Warm SQL count, both samples | 23 | 21 |
| Sample A median projection duration | 5,344.57 ms | 3,224.73 ms |
| Sample B median projection duration | 5,454.08 ms | 4,405.03 ms |
| Sample A raw JSON | 4,002 bytes | 3,941 bytes |
| Sample B raw JSON | 4,714 bytes | 4,671 bytes |
| Sample A gzip JSON | 1,241 bytes | 1,232 bytes |
| Sample B gzip JSON | 1,562 bytes | 1,542 bytes |
| Header requests on initial load, mocked network integration | 1 | 1 |
| Production browser rendering time / full HTTP latency | Not measured | Not measured |

The pooled median improvement is about 40%; individual learner medians improve
about 40% and 19%. This is a small, variable sample, not a production percentile
or statistical guarantee: one optimized trial was slower than its baseline.
The earlier paired experiment also improved pooled median duration (5,566.16 to
4,339.05 ms). Size savings are small; reduced database work is the useful result.
Legacy JSON matched byte-for-byte for every paired read in both experiments.

Gzip sizes use Python `gzip.compress` at its default level 9 with `mtime=0`;
they are deterministic serialization measurements, not observed proxy/browser
transfer sizes.

The machine-readable [performance record](student_header_performance_2026-10-17.json)
contains every measured SQL statement, alias, row count and duration from the
final experiment, plus an application-function inventory from a separate traced
run (260 baseline / 184 optimized unique application function names). Function
tracing is excluded from latency comparisons. That trace used the earlier main
revision `322a18e3d`; subsequent main changes did not affect Header files or any
traced backend function. Dynamic coverage is limited to the sampled paths; it
does not inventory unexecuted apprenticeship or error-path SQL.

## Request and database flow

`page.tsx` → `useDashboardHeader` → `dashboardHeader.read` →
`readLearnerJson` → existing `cachedRequest` / `learningFetch` →
`learner_api/urls.py` → `dashboard_header.dashboard_header`.

The endpoint retains `require_GET`, `learner_self_or_staff` and
`learner_journal_view`. Ownership checks precede source reads; another learner
receives 404, employer 403, signed-out caller 401. Staff/admin preview behavior
is unchanged. Authentication's own database work is outside the benchmark.

Backend stages and their SQL are:

1. Narrow `Created_users` read using `HEADER_SOURCE_FIELDS`. The stored plan
   fields remain necessary for canonical effective assignment and access gates.
2. `header_identity`: `programme_status`, `_group_dates` (cohort fallback when
   required), `_first_session_unlocked` (apprenticeship compliance signatures),
   `access_gate` (compliance/invitation checks when required), `learning_access`
   (placement bridge and cohort start), `student_activity_available` (pure check).
3. `header_profile`: one `LearnerProfile` query, limited to two rows to detect a
   duplicate bridge, then the existing canonical `_validated_profile` check
   using the enrolment email/Aptem identity already read. Missing, duplicated,
   conflicting and cross-identity profiles still fail closed. No email fallback,
   identity healing or source writes are introduced.
4. `_effective_plan_ids` (group preset when required),
   `curriculum_module_ids_for` (source membership/catalogue join), module metadata
   (groups coach fallback, `EXISTS` for authored weeks), `header_sessions`
   (shared-series recursive owner traversal and next occurrence), `lecture_href`
   (authored live components for the selected module's destination).
5. `current_coach` / `source_coach` (staff-name resolution if required),
   `assigned_group_coach` (placement-safe in-memory fallback), `coach_phone`.
6. `plan_reviews` → `coaching_events_for_learner`: ownership/current-cycle
   calendar records; generated programme/template/type/override/addition reads;
   imported Aptem review/link/booking reads where applicable; canonical booking
   reconciliation. `next_review` preserves booking precedence, statuses, UK time
   and ties. Historical rows needed for reconciliation remain; no unsafe LIMIT
   is applied before bookings have replaced their placeholders.
7. `upcoming_assignment_deadlines(header_only=True)`: the existing current-plan
   scope/visibility/progress query plus scheduling keys, with the authored due
   rule filtered in SQL. `read_builder_activity_dates` receives those preloaded
   assignments, still reads every week including empty ones, and invokes the
   same holiday and module scheduler. Completion and final date/identity ordering
   still use `merged_activities` and the original deadline rule. No all-component
   query is needed. `header_modules` / `weekly_header_candidates` retain placement
   matching and browser date/locale selection.

The detailed SQL record is the inventory for executed paths; conditional stages
above explain why counts differ between learners and cold/warm processes.

## JSON field consumers and V2

V2 is explicitly selected with `X-LMS-Header-Version: 2`. Missing/unknown versions
receive the original contract. Responses remain `private, no-store`, with
`Vary: X-LMS-Header-Version, Cookie`. Existing client cache keys include headers,
so legacy and V2 responses cannot collide.

| Legacy field(s) | Actual consumer / decision | V2 treatment |
| --- | --- | --- |
| `learner.id` | Learner identity contract; route identity also remains in URL/hook | Retained |
| `learner.name`, `programme`, `cohort`, `employer`, `organization` | Hero identity, programme description, employer/organization cards | Retained |
| `learner.programmeStatus` | Hero status, onboarding/fresh/pre-start redirects, staff preview, tab enablement, sidebar sync | Retained |
| `learner.onboardingStatus`, `firstSessionUnlocked` | `syncLearnerStatus` / sidebar review and first-session navigation | Retained |
| `learner.learnerStartDate`, `learnerEndDate` | `learnerRecordedDates` / displayed recorded dates; tab period fallback | Retained |
| `learner.programmeStartDate`, `programmeEndDate` | DashboardTabs programme-period fallbacks | Retained |
| `learner.accessGate` including blocked/reasons/startDate/outstandingDocuments | Assigned-programme gate, waiting copy, invitation notice, sidebar readiness | Retained whole |
| `learner.learningAccess` including blocked/startDate | Teaching access notice and programme-period fallback | Retained whole |
| `learner.studentActivityAvailable` | Commercial pre-start handling, history/sidebar eligibility | Retained |
| `schedule.coach.name/email/phone` | Coach card, mail/tel buttons, review booking dialog coach metadata | Top-level `coach` |
| `schedule.modules[].id/title/start_date/end_date` | Module list/label, Continue Learning, module destinations, browser locale/date rules | Top-level `modules`, all candidates retained |
| Module `subjectId` when present | Imported subject routing (test scenarios and compatible type) | Preserved by module objects |
| `weeklyCandidates[].id/title/start_date/end_date` | Initial weekly module selection, same browser ordering | Retained separately; may have a different placement fallback than hero modules |
| `schedule.sessions[].id/moduleId/title/start` | Selected live card, route fallback, time/date, expiry identity | Singular `nextLiveSession`; `start` renamed `date` |
| Session `status` | Legacy client eligibility filter; server already applied identical eligibility | Omitted from V2 |
| `lectureHref` | Exact authored live-component Attend destination | `nextLiveSession.href` |
| `schedule.reviews[].id/eventKey/source/title` | MCM/review title, booking identity, calendar route, review detail/Attend route | `nextReview.sessionId/eventKey/source/title` |
| Review `scheduledDate/scheduledTime/meetingLink` | Schedule versus Attend, booking dialog, UK display and expiry | Retained when present |
| Review `date/targetDate` | Legacy selection fallbacks | One resolved `nextReview.date`; unused alternatives omitted |
| Review `status` | Legacy eligibility filtering; already applied server-side | Omitted from V2 |
| `week.deadlines[].id/title/date` | Due-soon card, expiry identity and date display | Singular `nextDeadline` |
| Deadline `type` | Legacy client category filtering; Header already returns assignments only | Omitted from V2 |
| `schedule`, `week`, single-element event arrays | Legacy transport wrappers | Removed from V2; legacy unchanged |

Missing cards are `null`. Continue Learning still derives its destination from
the browser-selected module using `learnerModuleHref`; moving locale collation
to Python would risk changing selection. View All and assignment routing remain
the existing routes. `headerItems` only checks expiry; it does not merge, sort or
transform legacy events. Module selection is memoized by candidates and UK day.
Hero markup/styles and shared Home selectors were not changed.

## Cache, duplication and remaining work

The existing 30-second learner JSON cache and in-flight sharing are reused. No
new cache namespace/layer was introduced. `useLiveLearnerRead` subscribes to
existing learner invalidation; enrolment/coach edits, calendar mutations,
assignment actions and curriculum learner assignments already reach it through
their existing invalidators. Header now also uses the existing remote-write
hook for schedule/review/holiday changes and unknown curriculum epochs. Unrelated
KSB changes do not refresh Header. Account changes clear shared caches through
`useAuth`; learner kind/ID/version remain separate cache keys. Server permission
checks remain authoritative on every request.

The initial request graph already made one Header request; this remains one,
including StrictMode. The weekly tab still needs some of the same assignment,
module, profile and calendar data as Header. Overview/training/monthly tabs may
also repeat canonical context. They are independent endpoint contracts, and
this change deliberately does not add a cross-request server cache or refactor
those dashboard features. Reviews still perform programme/template lookup and
canonical reconciliation; assignments still need all eligible candidates until
their real dates/completion are known. Those are the remaining backend costs.

## Validation and limits

Backend tests use Python `unittest` directly with
`DJANGO_SETTINGS_MODULE=config.settings_sqlite_test` and `django.setup()`, never
`manage.py test` or the provisioning runner. All selected tests are database-free
`SimpleTestCase`; PostgreSQL benchmarking uses enforced read-only connections.

- PASS: 54 backend tests in `test_dashboard_header_no_db`,
  `test_header_deadlines_no_db`, `tests_overview_week`.
- PASS: 73 frontend tests in the eight focused suites below; profile/coach/module
  actions, View All/Continue Learning, review booking/Attend, live-component
  routing, assignment routing, expiry, missing data, access gates, staff previews,
  StrictMode deduplication, learner isolation and mutation/remote invalidation.
- Broader learner pages: 101 pass / 13 fail, identical failure names on clean
  baseline and optimized source (173 pass / 13 fail when combined with focused
  suites). Existing failures concern stale date/metrics/attendance expectations
  and a Vite PDF worker denial with linked installed dependencies.
- Canonical Builder date suite: 10 pass / 1 fail, reproduced on clean main:
  `test_selected_holidays_move_components_into_the_correct_month` expects
  `2026-11-02` but receives `2026-10-26`. No assertion or scheduling logic changed.
- Type-check: missing installed `qrcode.react` in unrelated engagement code.
  No packages/configuration changed to work around this prerequisite.
- Lint: 32 errors / 139 warnings, identical findings on baseline and optimized
  source; no findings in changed files.
- Teams baseline / expanded Teams checks: NOT REQUIRED. No listed Teams file,
  or function/type/response used by one, was changed. Live Teams: NOT RUN.
- NOT MEASURED: full authenticated HTTP latency, production browser rendering,
  production percentiles, live Microsoft behavior. No live application/browser
  workflow or mutating database test was run.
- Real measurement coverage: two active commercial learners; the selector found
  no apprenticeship learner meeting its active/current-plan criteria. Both kinds,
  forbidden roles, missing data and blocked learners have synthetic tests, not
  equivalent live performance measurements. Full acceptance remains limited by
  the unresolved shared checks and missing browser/HTTP measurements.

Focused frontend command (from repository root):

```powershell
npm --prefix frontend run test -- src/api/__tests__/dashboardHeader.test.ts src/pages/workspace/learner/__tests__/headerItems.test.ts src/hooks/__tests__/useDashboardHeader.test.tsx src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx src/pages/workspace/learner/__tests__/learnerHeaderPlan.test.ts src/api/__tests__/learnerRead.test.ts src/api/__tests__/curriculumLearnerAssignments.test.ts src/api/__tests__/wizardCacheInvalidation.test.ts --maxWorkers=2
npm --prefix frontend run type-check
npm --prefix frontend run lint
```

Backend command (from `backend`, no provisioning runner):

```powershell
$env:DJANGO_SETTINGS_MODULE='config.settings_sqlite_test'
python -c "import django,unittest; django.setup(); names=['learner_api.test_dashboard_header_no_db','learner_api.test_header_deadlines_no_db','learner_api.tests_overview_week']; r=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromNames(names)); raise SystemExit(not r.wasSuccessful())"
```

Benchmark (from repository root, using an existing protected environment file;
the baseline checkout must contain the pre-change Header):

```powershell
python backend/scripts/benchmark_dashboard_header.py --baseline-root <clean-main-checkout> --env-file <existing-env-file> --output <local-output.json> --runs 3
```

Add `--trace-functions --runs 1` for a separate function inventory, not latency
comparison. The baseline Header imports the current shared deadline helper with
its unchanged legacy default; paired JSON parity guards the scenario outputs.

## Exact changed files

Production:

- `backend/learner_api/dashboard_header.py`
- `backend/learner_api/overview_week.py` (Header-only opt-in; legacy callers unchanged)
- `frontend/src/api/dashboardHeader.ts`
- `frontend/src/hooks/useDashboardHeader.ts`
- `frontend/src/pages/workspace/learner/page.tsx`
- `frontend/src/pages/workspace/learner/headerItems.ts`

Tests, benchmark and audit artifacts:

- `backend/learner_api/test_dashboard_header_no_db.py`
- `backend/learner_api/test_header_deadlines_no_db.py`
- `backend/scripts/benchmark_dashboard_header.py`
- `backend/reports/student_header_performance_2026-10-17.json`
- `frontend/src/api/__tests__/dashboardHeader.test.ts`
- `frontend/src/hooks/__tests__/useDashboardHeader.test.tsx`
- `frontend/src/pages/workspace/learner/__tests__/headerItems.test.ts`
- `frontend/src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx`
- `frontend/src/pages/learner/__tests__/pages.test.tsx` (synthetic response contract only)
- `frontend/src/test/dashboardHeaderFixture.ts`
- `backend/reports/student_header_audit_2026-10-17.md`
