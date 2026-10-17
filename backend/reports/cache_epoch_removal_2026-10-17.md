# Disable automatic curriculum change tracking

User-approved scope: remove `cache-epoch/` requests application-wide and stop
following remote curriculum changes. Local checkout/branch: `LMS_v2`,
`coach_view`. No commits, pushes, deployment, migrations or database writes.

Changed files:

- `frontend/src/lib/curriculumApi.ts`: remove epoch polling, initial/visibility/
  activity/delayed-save epoch reads, and curriculum cross-tab subscription and
  publication. Retain the subscription export as an inert compatibility API for
  existing hooks. Preserve local mutation invalidation, request deduplication,
  explicit revalidation, authorization and meeting request/response contracts.
- `frontend/src/lib/__tests__/curriculumApi.crossTab.test.ts`: replace tests for
  the intentionally removed tracking behavior with tests for zero polling and
  remote notifications, explicit refresh, local-save invalidation and preview
  invalidation across a save. No test is skipped to obtain a passing result.
- `frontend/src/hooks/__tests__/useCurriculumKsbSets.strictmode.test.tsx`: require
  exactly one shared data request and no initial epoch read under StrictMode.
- `backend/reports/cache_epoch_removal_2026-10-17.md`: this handoff.

The backend endpoint remains compatible with legacy clients; the current
frontend no longer calls it. Normal local-save refresh and existing focus/manual
refresh behavior remain. A full browser reload ends any timer already created
by the older JavaScript bundle.

Validation:

- Feature checks: 146 passed / 1 failed, using
  `npm --prefix frontend run test -- src/lib/curriculumApi src/lib/__tests__/curriculumApi src/hooks/__tests__/useRefreshOnReturn.test.tsx src/hooks/__tests__/useCurriculumKsbSets.strictmode.test.tsx --maxWorkers=2`.
  The existing failure is `curriculum request layer > one subscriber aborting
  never cancels the shared request for the others`: expects no fetch signal but
  receives the existing request-timeout AbortSignal, followed by an unhandled
  rejection because the assertion prevents the test completing its promises.
  Reproduced unchanged before this edit in the reconstructed baseline checkout
  with `npm --prefix frontend run test -- src/lib/__tests__/curriculumApi.dedupe.test.ts -t 'one subscriber aborting' --maxWorkers=2`.
- Frontend Teams baseline: PASS, 119 tests across 9 suites,
  `npm --prefix frontend run test:teams` after the final Teams-file edit.
- Database-free expanded backend checks: PASS, 14 tests. Run from `backend` with
  `DJANGO_SETTINGS_MODULE=config.settings_sqlite_test`, verify every configured
  alias uses SQLite, use process-local cache, call `django.setup()`, then invoke
  Python unittest for `curriculum_api.tests.TeamsMultiDayRecurrenceTests`,
  `curriculum_api.tests.TeamsAttendanceRosterTests`, and
  `learner_api.test_teams_attendance_module_roster_no_db`.
- Expanded backend database suites: BLOCKED / NOT RUN. The remaining
  `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`, coach booking/
  Graph failure/concurrency/ownership suites, and learner attendance/calendar
  database suites provision or mutate records. Running them would conflict with
  the user's no-database-writes restriction; a permitted writable isolated test
  database is the missing prerequisite. No backend meeting behavior was edited.
- Lint: 32 errors / 139 warnings elsewhere, matching previous runs; no findings
  in the three changed frontend files. Command: `npm --prefix frontend run lint`.
- Type-check: BLOCKED by missing installed `qrcode.react` in the unrelated
  engagement events page (`src/pages/engagement/events/page.tsx:18`). Command:
  `npm --prefix frontend run type-check`. No package or runtime
  configuration changes were made to bypass it.
- `git diff --check`: PASS.
- Live Teams / live database / authenticated browser workflows: NOT RUN.

Acceptance limits: automated tests prove the disabled request paths with mocked
transport. No production deployment or live browser request capture was made.
Full Teams validation remains incomplete while the database suites are blocked.
