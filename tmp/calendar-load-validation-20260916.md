# Learner calendar loading fix — 2026-09-16

Scope: restore learner coaching-session reads while preserving Teams bookings.
No database changes, migrations, live Microsoft requests, Git writes or deployment were performed.
Existing teammate changes were preserved.

## Change and evidence

- `backend/learner_api/calendar.py`: when merging a saved booking with a generated legacy cycle, copy only fields present in that generated event. Legacy events omit Curriculum Review metadata such as `reviewTemplateId`; unconditional indexing raised an unhandled `KeyError` and prevented the whole calendar from loading.
- `backend/learner_api/tests_learner_calendar_cycle.py`: add endpoint regression coverage for commercial/apprenticeship learners, monthly coaching/progress reviews, and scheduled/completed records. Repeated reads preserve one booking, its scheduled time, organizer, Teams link, remote invitation state, notes and signature. No save or Graph request is made.
- `tmp/calendar-load-offline-20260916.py`: local verification harness using synthetic settings, dummy database backends, blocked database connections/cursors, blocked network connections and blocked background threads. It does not load deployment settings, dotenv files, Django's database test runner or application startup hooks. Only `SimpleTestCase` suites are accepted.

Before the production edit, the new regression failed in all eight parameter combinations with `KeyError: 'reviewTemplateId'`. The existing training-plan test also reproduces the same error using the original function in memory. The source calendar file was clean at task start, so `--before-fix` reads that function from HEAD without changing the working tree.

The screenshot's exact request was not replayed against a live environment. Available local calendar logs did not contain the matching 500 traceback. This fixes a demonstrated failure in the affected endpoint; it does not establish that every possible 500 has the same cause.

## Commands and results

Run from `E:\LMS_v2`.

Frontend Teams baseline — PASS before and after the production change: 9 files, 70 tests.

```powershell
npm --prefix frontend run test:teams
```

Feature and shared-consumer checks — PASS: 90 tests.

```powershell
backend/.venv/Scripts/python.exe tmp/calendar-load-offline-20260916.py learner_api.tests_learner_calendar_cycle learner_api.tests_booking_calendar learner_api.tests_training_plan_dashboard learner_api.tests_meeting_attendance
```

Expanded no-database Teams checks — FAIL: 24 tests, 21 passing, two failures and one error.

```powershell
backend/.venv/Scripts/python.exe tmp/calendar-load-offline-20260916.py coach_api.tests_calendar_sync_visibility coach_api.tests.CoachTimetableBookingConflictTests coach_api.tests_errors curriculum_api.tests.TeamsMultiDayRecurrenceTests curriculum_api.tests.TeamsAttendanceRosterTests
```

The same three outcomes reproduce with the pre-fix function in the same isolated harness:

```powershell
backend/.venv/Scripts/python.exe tmp/calendar-load-offline-20260916.py --before-fix coach_api.tests_calendar_sync_visibility coach_api.tests.CoachTimetableBookingConflictTests coach_api.tests_errors curriculum_api.tests.TeamsMultiDayRecurrenceTests curriculum_api.tests.TeamsAttendanceRosterTests
```

- `CalendarSyncVisibilityTests.test_saved_booking_is_not_duplicated_when_generated_key_matches`: the mocked coach event lacks `learnerId`; raises `KeyError` in the coach timetable.
- `CoachErrorSecurityTests.test_batch_wrapper_does_not_reintroduce_exception_leakage`: the unauthenticated synthetic batch request returns 401; the test expects 500. Authentication was not disabled to force this test to pass.
- `TeamsAttendanceRosterTests.test_adds_invited_non_attendees_to_completed_roster`: an empty interval fixture produces `attended=False`; the test expects `True`.

No expectations or existing assertions were weakened, and these unrelated tests/code were not edited. These outcomes describe this isolated runner, not live Microsoft behavior.

Existing shared-consumer reproduction — FAIL before the fix, PASS in the final feature run:

```powershell
backend/.venv/Scripts/python.exe tmp/calendar-load-offline-20260916.py --before-fix learner_api.tests_training_plan_dashboard.TrainingPlanDashboardTests.test_overview_reads_current_calendar_targets_and_stored_booking_changes
```

Diff whitespace check — PASS:

```powershell
git diff --check -- backend/learner_api/calendar.py backend/learner_api/tests_learner_calendar_cycle.py
```

## Remaining validation limits

- Database integration suites are BLOCKED / NOT RUN under AGENTS.md: `CoachCalendarRaceTests`, `CoachAuthorizationSecurityTests`, `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`, and database-backed review scheduling integration. Their existing setup creates/mutates schema or fixtures. An owner-controlled, explicitly authorized isolated database test environment is required; none was provisioned or used here.
- Live Teams and browser validation: NOT RUN. No meeting was created, moved, cancelled or deleted; no invite was sent. A separately authorized test environment is required for live effects.
- Frontend type-check/build/lint: NOT APPLICABLE to this backend-only source change.
- Full acceptance remains outstanding because expanded checks have failures and database/live integration checks were not run.
