# Learner Dashboard profile audit

Audit completed before implementation against main `2ff6cfb82`.
The supplied `/learner_api/dashboard/commercial/265/` example does not exist in
this revision. The actual identity request is `/learner_api/learner-summary/commercial/265/`.

## Field usage matrix

Paths below are relative to `frontend/src`. “Initial” includes sidebar gates and
initial loading decisions. All fields also occur in the larger learner-detail
response; that response is not a safe replacement for the independent identity
request because it loads asynchronously and serves content/progress consumers.

| Field | Exact consumer | Initial | Duplication / decision |
| --- | --- | --- | --- |
| id | pages/learner/clubs/components/LeaderboardTab.tsx setResolvedLearnerId(detail.id) | Shared pages | Keep canonical identity for existing consumers |
| name | pages/workspace/learner/page.tsx heroName, heroFullName; pages/learner/home/page.tsx | Yes | Keep displayed identity |
| email | pages/learner/clubs/page.tsx and clubs/events/page.tsx createEventBooking | No, booking | Keep for shared summary consumers |
| phone | No summary consumer (coach.phone comes from schedule) | No | Remove from new projection |
| programme | pages/workspace/learner/page.tsx heroProgramme, learnerHeaderPlan; Rewards/Clubs headers | Yes | Keep placement and display |
| programmeStatus | pages/workspace/learner/page.tsx onboarding/fresh/first-login redirects, pre-start loading, hero; hooks/useLearnerNavGate.ts | Yes | Keep gates and navigation |
| onboardingStatus | hooks/useLearnerNavGate.ts syncLearnerStatus, reviews unlock | Yes | Keep navigation |
| firstSessionUnlocked | hooks/useLearnerNavGate.ts first-session unlock | Yes | Keep navigation |
| cohort | pages/workspace/learner/page.tsx heroCohort, learnerHeaderPlan; pages/learner/clubs/components/LeaderboardTab.tsx | Yes | Keep placement/display |
| group | pages/workspace/learner/learnerHeaderPlan.ts placement filter, called by page.tsx | Yes | Keep correct module selection |
| employer | pages/workspace/learner/page.tsx LearnerDashboardHero employer | Yes | Keep visible information |
| employerId | No summary consumer | No | Remove from new projection |
| organization | pages/workspace/learner/page.tsx LearnerDashboardHero organization | Yes | Keep visible information |
| learnerType | hooks/useLearnerNavGate.ts rememberLearner, learnerKindKey | Yes | Keep identity/navigation |
| isActive | No summary consumer; Dashboard uses programmeStatus and access gates | No | Remove from new projection |
| programmeStartDate | pages/workspace/learner/page.tsx DashboardTabs programmeStartDate fallback | Yes | Also schedule.programmeStartDate; keep fallback/loading semantics |
| learnerStartDate | lib/learnerRecordedDates.ts used by Dashboard hero; DashboardTabs fallback | Yes | Keep learner-recorded date distinct from cohort date |
| learnerEndDate | lib/learnerRecordedDates.ts used by Dashboard hero; DashboardTabs fallback | Yes | Keep learner-recorded date distinct from programme date |
| programmeEndDate | pages/workspace/learner/page.tsx DashboardTabs programmeEndDate fallback | Yes | Also schedule.programmeEndDate; keep precedence semantics |
| accessGate | utils/learnerAccessGate.ts canViewAssignedProgramme/waitingCopy; Dashboard notices; hooks/useLearnerNavGate.ts | Yes | Keep all nested fields unchanged |
| learningAccess | Dashboard startDatePending/start notice; hooks/useLearnerNavGate.ts; components/feature/LearnerProgrammeGate.tsx | Yes | Keep blocked and startDate unchanged |
| studentActivityAvailable | Dashboard skipPreStartData; hooks/usePrefetchStudentActivity.ts; hooks/useLearnerNavGate.ts | Yes | Keep historical activity availability |

## Implementation boundary

Keep the legacy summary route and complete response intact. Add a compact profile
route with the same authorization decorator and gate helpers. Migrate the
existing summary resource URL (including sidebar callers) together, retaining
its cache name, TTL, in-flight deduplication, invalidation and detail-cache reuse.
This avoids separate profile and sidebar identity requests. Other dashboard
endpoint contracts, Coach/Admin clients and UI remain untouched.

The view already uses selective ORM retrieval, with no serializer or full detail
builder. Include `learner_end_date` in the projection to prevent its deferred
query. Keep access-gate plan/document checks: they implement business rules and
must not be replaced by defaults. No schema changes or live external effects.

## Results and measurement limits

| Metric | Before | After | Evidence |
| --- | --- | --- | --- |
| Actual route in this revision | /learner_api/learner-summary/commercial/265/ | /learner_api/dashboard/commercial/265/profile/ | URL configuration and client tests |
| Top-level JSON fields | 22 | 19 | Executed views with synthetic fixture |
| Synthetic serialized JSON bytes | 623 | 572 | Django JsonResponse.content, UTF-8; original main view versus profile |
| Synthetic gzip body bytes | 311 | 291 | Python gzip level 9, mtime=0, identical fixture/settings |
| Live JSON bytes | NOT MEASURED | NOT MEASURED | No verified authenticated learner environment |
| Browser transfer bytes | NOT MEASURED | NOT MEASURED | No identical live compression/browser capture; gzip figures above exclude transport overhead |
| PostgreSQL query count | NOT MEASURED | NOT MEASURED | No verified PostgreSQL test target; mocked tests do not establish query counts |
| Backend response time | NOT MEASURED | NOT MEASURED | No representative database/HTTP environment |
| Live initial Dashboard request count | NOT MEASURED | NOT MEASURED | No safe live browser environment |
| New initial profile request count in React test | NOT MEASURED | 1 | StrictMode Dashboard rendering and concurrent-hook/sidebar tests |

Full before/after JSON is in [learner-dashboard-profile-examples.md](learner-dashboard-profile-examples.md).
The query improvement is structural, not a measured PostgreSQL result:
`learner_end_date` is selected with the source instead of fetched on access.
No full-detail, activity collection or progress serialization was added. Existing
access checks can still load plan/document data required to decide availability;
this change does not claim to optimize those shared rules.

## Validation

All backend execution used `DJANGO_SETTINGS_MODULE=config.settings_sqlite_test`
and `CURRICULUM_WARM=false`, and Django's standard `DiscoverRunner` (not the
project provisioning runner). Settings verified both aliases as SQLite;
SimpleTestCase suites use mocks and forbid real database queries.

- Backend: `learner_api.tests_dashboard_profile`, `tests_onboarding_status_summary`,
  `tests_aptem_status`, `tests_invitation_readiness`, `tests_learner_loading`:
  **43 passed**. An existing invitation test logs a caught forbidden database
  lookup; the suite passes and no live external request is made.
- `npm --prefix frontend run type-check`: **PASS**.
- Frontend focused suites: `dashboardProfile.test.tsx`, `learnerNavigation.test.tsx`,
  `useLearnerNavGate.test.tsx`, `LearnerSidebarNavigation.test.tsx`,
  `SidebarLockedItem.test.tsx`, `LearnerDashboardHero.test.tsx`,
  `pages/learner/home/page.test.tsx`: **62 passed**; after adding the personal-course
  compatibility test, `dashboardProfile.test.tsx` independently **3 passed**.
- `npm --prefix frontend run test -- src/pages/learner/__tests__/pages.test.tsx -t
  'renders the compact Dashboard profile|keeps the waiting page|gives a commercial learner|shows the Dashboard for|keeps a super-admin'
  --maxWorkers=2`: **6 passed, 105 outside the selected cases**. The new test
  checks rendering without removed fields, organization/employer display and
  one initial identity request. Existing cases cover pre-start gates and staff preview.
- Broad learner-page run: **93 passed, 17 failed** before the new rendering test.
  Untouched main `2ff6cfb82` reproduced **the same 17 failures**: outdated date,
  attendance/metrics/loading expectations and two PDF worker imports denied by
  Vite when using the shared node_modules junction. No assertions were weakened.
- Rewards/Leaderboard suites: **9 failed**, with the same 9 reproduced on
  untouched main; missing Router context in their fixtures.
- `npm --prefix frontend run lint -- --quiet`: **FAIL, 32 errors**. Untouched main
  reproduces the same diagnostics (audit `@ts-nocheck` and undefined
  `MutationCallback` in an existing test). Preserve these unrelated files.
- `git diff --check`: **PASS**.
- Teams baseline and expanded checks: **NOT REQUIRED**; no Teams file or contract
  consumed by a listed Teams file changed. Live Teams: **NOT RUN**.
- No schema migrations, `.env` changes, live learner writes or production edits.

## Compatibility and release

The old learner-summary route retains every field and value; only object-key
ordering changes. The supplied `/dashboard/commercial/265/` example was absent
from current main, so there is no existing handler at that path to migrate.
Deploy backend before/with the frontend because the new bundle needs the profile
route. All real-learner summary callers share the new URL/cache to avoid duplicate
sidebar and Dashboard requests. Personal-course `pl.*` identities retain their
legacy summary adapter. Existing detail-cache reuse can supply the larger detail
object on a warm navigation, preserving existing behavior.

Mandatory lint/broad checks remain failing on baseline, and live performance
measurements remain outstanding. Do not label the release fully validated or
deploy it until review resolves the acceptance gate. Work is isolated on
`perf/learner-dashboard-profile`; the owner's original checkout is preserved.
