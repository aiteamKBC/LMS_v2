# Learner fetching and regression checks

## Changes

- Learner JSON reads share concurrent requests, including React StrictMode remounts. Cancelling one component does not cancel another component's shared request.
- A 45-second deadline covers both fetching response headers and reading JSON. Network, HTTP and malformed-response failures release the request so a retry can succeed.
- Learner detail, identity summaries, attendance, subject activity, subject covers and imported review history reuse short-lived, in-memory snapshots. Live records and signing/download URLs share only requests still in flight.
- Learner, filters and headers identify a read. Signing out or changing account clears the caches. Older pending responses cannot repopulate an invalidated cache.
- Rewards, clubs, events, flash cards and the leaderboard request the small learner summary instead of the full learning plan.
- Cached learning pages render immediately on revisit. Attendance no longer waits for absence reports; the profile no longer waits for attendance. Profile, attendance, progress, learning plan and evidence expose recoverable loading errors.
- Evidence ignores a response belonging to a previous learner after navigation. Previous-learning record reads also have a deadline.
- Learner detail, activity and subject metadata can show a snapshot for up to five minutes beyond the 30-second freshness window while revalidating. Saves and account changes still remove these snapshots immediately.
- The route error boundary resets errors without remounting the shared access layout and Suspense boundary on every navigation. Hovering, focusing or pressing a learner link preloads its page chunk; failed speculative loads do not reload the current page.
- Native activity links use React Router instead of reloading the document. Historical activity starts alongside the full plan request once the small identity summary confirms availability.
- Progress projections reuse prefetched database rows, including after a KSB refresh. The master-component query omits two unused authoring fields, preserving the material runner's content fields.
- The external subject-source cache starts freshness and retry backoff after a request completes. Failed first reads receive a 30-second backoff; a slow timeout cannot expire its own cache entry before insertion.
- Added the missing HTML entity decoder import used by retained activity schedules.

## Frontend

From `frontend`:

```powershell
npm run test:learner
npm run build
npm run type-check
```

`test:learner` includes learner pages, learner workspace, shared hooks/API regressions, previous-learning records, shared feature components and router navigation. The page matrix imports all 37 page entry modules automatically, so newly added learner pages join the suite.

Final result: **640 passed, 0 failed** across 65 test files, including 78 page-matrix and loading/recovery cases. Backend result: **259 passed, 0 failed**.

Each entry is rendered as both commercial and apprenticeship, with empty successful responses and with HTTP 503 responses: 148 combinations. Assertions check for render crashes, unmodelled reads, blank output and loading skeletons that never clear. Existing focused tests also cover populated activities, assignments, videos, reviews and training plans.

| Area | Page entry modules |
| --- | --- |
| Workspace and identity | `workspace/learner`, `learner/profile`, `learner/onboarding`, `learner/onboarding/reviews` |
| Learning | `learner/my-learning`, `learner/learning-plan`, `learner/learning-plan/modules`, `learner/week-detail`, `learner/this-week`, `learner/training-plan-timeline` |
| Activities | `learner/video-watch`, `learner/quiz-take`, `learner/monthly-submission`, `learner/flash-cards` |
| Progress and documents | `learner/progress`, `learner/evidence`, `learner/gateway`, `learner/compliance` |
| Attendance and coaching | `learner/attendance`, `learner/report-absence`, `learner/catchup`, `learner/calendar`, `learner/monthly-cycle`, `learner/monthly-coaching`, `learner/progress-reviews` |
| Clubs and events | `learner/clubs`, `learner/clubs/detail`, `learner/clubs/discussion-detail`, `learner/clubs/badge-detail`, `learner/clubs/events`, `learner/clubs/events/detail`, `learner/clubs/events/schedule` |
| Rewards and support | `learner/rewards`, `learner/rewards/badge-detail`, `learner/support`, `learner/knowledge-base`, `learner/messages` |

Additional fetching checks exercise concurrent reads, cancellation, cache expiry, forced refresh, invalidation during a pending read, account changes, delayed headers/body, HTTP 401/403/500, malformed activity responses, optional service delays, retry buttons, first-frame cached rendering and stale evidence after navigation. Navigation regressions use the actual AppRoutes wrapper with controlled route fixtures to check that a slow chunk keeps the current page visible, the access layout remains mounted, and navigating away clears a route error. Further tests cover background revalidation, parallel activity loading and opening native activities without document navigation.

The matrix uses jsdom, mocked fetch responses and mocked authentication/navigation chrome. Static/demo pages are rendering checks, not live-data integration checks. Registered page paths are used where available; legacy modules without a registered route are mounted directly. No browser session or real student data is used, and incidental writes are intercepted locally.

## Backend

The selected 259 database-free learner API tests pass. They cover learner details, historical activity and material, attendance, booking/calendar, training plans, reviews, certificates, assignments, evidence and access gates. Source-cache tests include slow failures and freshness measured from completion; progress tests refuse database access while projecting prefetched history and answers repeatedly.

From `backend`, using the ordinary Django runner with these `SimpleTestCase` modules:

```powershell
$env:AZURE_MAIL_ENABLED = 'false'
$env:CURRICULUM_WARM = 'false'
./.venv/Scripts/python.exe manage.py test learner_api.tests learner_api.tests_subject_source learner_api.tests_student_activity learner_api.tests_learner_calendar_cycle learner_api.tests_training_plan_dashboard learner_api.tests_booking_calendar learner_api.tests_review_history learner_api.tests_certificates learner_api.tests_assignment_content learner_api.tests_assignment_history learner_api.tests_evidence_can_delete learner_api.tests_evidence_file_types learner_api.tests_access_gate --testrunner=django.test.runner.DiscoverRunner --noinput
```

Outdated fixtures were updated for the current curriculum row shape, authentication, marking lookups and monthly-assignment checks. A duplicate context-manager line in the calendar test prevented collection; it was corrected. An obsolete activity-lineage helper test now checks the current explicit-ID cover lookup contract.

No database changes or migrations were executed. Database-dependent integration suites are outside this run.

## Read-only timing observations

On the local development machine, a guarded diagnostic of learner 125's detail read/serialization path took 19.574 seconds before and 8.420 seconds after the query changes, with 43 and 37 queries respectively. Both returned 3,515 components and 9,223,311 JSON bytes. These are individual observations against a remote database, not a controlled latency guarantee; existing GET-time mutation helpers were disabled and a SQL guard rejected non-read statements.

The external subject source failed after 14.101 seconds. An immediate second lookup used the corrected failure cache and completed in 0.085 seconds, including identity verification. First uncached reads can still wait on that source; the source outage itself is not fixed by these navigation changes.

## Validation limits

Production build passes. Project-wide TypeScript checking still reports existing errors in `admin/users/AccessPanel.test.tsx`, `curriculum/programme-detail/SessionsTree.tsx`, `curriculum/teams-meetings/page.tsx`, `users/components/CreateEmployerModal.tsx` and `users/components/CreateUserModal.tsx`. The learner-related type errors found during this work were corrected.

These results verify request behavior and page recovery, not a live-browser latency benchmark. The first uncached request still depends on backend/database response time; the cache improves revisits and removes duplicate requests. Large media downloads have their own loading behavior and are not governed by the JSON-read deadline.
