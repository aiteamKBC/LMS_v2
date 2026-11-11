# Session results validation — 16 September 2026

## Scope

Admin Module Builder / Module Workspace / Teams dialog; learner live-session content and attendance; Teams report import; private Azure archive; coach-confirmed catch-up. Existing unrelated working-tree changes were preserved. No commits, remote Git operations, migrations, database changes, live meetings or test uploads were performed.

Azure external action: the authorized `session-recordings` container was created and confirmed private. File upload and playback were not exercised against live data.

## Automated evidence

| Check | Result |
| --- | --- |
| `npm --prefix frontend run test:teams` before edits | 69 passed, 1 failed. Pre-existing schedule chip mismatch at `scheduleTeamsCalendar.test.tsx:224`. |
| Same Teams baseline after implementation | PASS — 70 tests, 9 files. |
| Feature/shared learner suites below | PASS — 115 tests, 17 files. |
| `python -B backend/curriculum_api/test_session_results_no_db.py` | PASS — 43 tests. |
| `python -B backend/curriculum_api/test_calendar_actions_no_db.py` | PASS — 33 tests. |
| `python -B backend/curriculum_api/test_calendar_state_no_db.py` | PASS — 27 tests. |
| `python -B backend/curriculum_api/test_calendar_checks_no_db.py` | PASS — 17 tests. |
| AST syntax validation of affected backend files | PASS — no application imports or database setup. |
| `npm --prefix frontend run build -- --outDir <unique temporary directory>` | PASS. Existing dynamic-import/plugin-timing warnings remain. |
| `npm --prefix frontend run type-check` | FAIL — 31 existing diagnostics, no new feature diagnostic in the final check. |
| `npm --prefix frontend run lint` | FAIL — 137 errors, 111 warnings across the repository. Prior release baseline: 138 errors, 112 warnings. No lint suppression added. |
| `git diff --check` | PASS. Git emits existing LF/CRLF normalization notices. |

Feature command, from `frontend/`:

```text
./node_modules/.bin/vitest.cmd run src/components/feature/SessionResults.test.tsx src/pages/curriculum/module-builder/__tests__/learnerPreview.test.tsx src/pages/learner/attendance src/pages/learner/video-watch --maxWorkers=2
```

Coverage includes: >180-second threshold; interval overlap/reconnects; pending and anonymous identities; authenticated Join context limited to one occurrence; unchanged learner/enrolment identity; owner/other-learner/staff/admin boundaries; saved-file access; CSV formula escaping; Graph pagination failures; queue deduplication and leases; crash-safe reuse of an Azure upload; failed archive visibility; unchanged document URL lifetime; approved excuse versus completed catch-up; lazy session reads; transcript/export; learner roster privacy; material preview with no progress requests; Join becoming disabled while a page stays open without polling; existing learner assignment and content flows.

One baseline expectation was intentionally updated: opening the Teams page now checks calendar state but must **not** import/queue attendance and files. Background processing is the requested behavior. No test was skipped or assertion removed to conceal a failure. The schedule chip implementation now satisfies both the original compact upcoming-state test and the existing cancellation/evidence test.

## Validation limits — not production acceptance

- **Expanded Django/database suites: BLOCKED / NOT RUN.** The repository's runner provisions schema/fixtures, and no database-writing test environment was authorized under AGENTS.md. The no-database runners execute extracted functions, mocked transports and pure rules; they do not prove ORM/schema/SQL behavior. Owner-run verification is still required for applicable `TeamsMultiDayRecurrenceTests`, `TeamsAttendanceRosterTests`, `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`, coach booking/security/retry suites, learner Teams attendance/reporting/lecture/dashboard/calendar/cohort suites, and storage integration.
- **Live Teams / private MP4 upload and playback: NOT RUN.** Requires a specified authorized test tenant, test meeting and database-writing integration environment. No real invitations or learner evidence were touched by testing.
- **Visual browser inspection: BLOCKED.** Browser runtime initialized, but the connected-browser list was empty. No server connected to an unverified database was started. DOM-based interaction tests passed; screenshots/real-browser rendering remain unverified.
- **TypeScript/lint repository gates remain failed.** The 31 TypeScript diagnostics were present before this feature: 27 in test fixtures and four runtime-file errors in admin/users, users directory types and assignment PDF cleanup. These unrelated files were not modified to hide the failures.
- **Owner setup remains outstanding.** New SQL was written only; the scheduler was not activated and application code was not deployed. The SQL and commands are in [SESSION_RESULTS_OPERATIONS.md](SESSION_RESULTS_OPERATIONS.md).

## Main implementation files

- `curriculum_api/session_results.py`, `session_results_policy.py`, `session_graph.py`, `session_archive.py`, and `management/commands/process_session_results.py`.
- `learner_api/session_recovery.py`, Teams attendance/register integrations, authorized Join and artifact routes, and the existing coach completion/absence actions.
- Frontend `components/feature/SessionResults.tsx`, `module-workspace/ModuleSessions.tsx`, `module-builder/LearnerPreview.tsx`, `learnerPreviewData.ts`, and the existing curriculum/learner screens.
- Owner-run `sql/session_results_archive.sql`, `sql/session_attendance_reporting.sql`; existing `sql/attendance_absence_recovery.sql` is a prerequisite when not already installed.

## 5 November 2026 — Microsoft to Bunny recording cutover

Scope: recordings of lectures scheduled from 00:00 Europe/London on 5 November,
including the four explicitly requested recordings. The current branch is
`feature/learner-active-modules`. Existing Azure references and older recordings
are retained. Transcript/attendance storage, meeting creation, invitations,
attendance rules and learner authorization are preserved. No schema migration
is required. Local configuration changes are private and are not committed.

Final local checks (backend module commands run from `backend/`):

| Check | Result |
| --- | --- |
| `npm --prefix frontend run test:teams` | PASS — 147 tests, 9 files. Required because shared recording APIs/player are consumed by Teams screens. |
| Frontend feature command below | PASS — 113 tests, 5 files. |
| `npm --prefix frontend run type-check` | PASS. |
| `npm --prefix frontend run lint` | PASS. |
| `npm --prefix frontend run build -- --outDir <temporary directory>` | PASS — 4435 modules; existing library eval/chunk/plugin warnings. |
| `python -B -m curriculum_api.test_session_results_no_db` | PASS — 148 tests. |
| `python -B -m curriculum_api.test_recordings_library_no_db` | PASS — 35 tests. |
| `python -B -m curriculum_api.test_session_recording_review_no_db` | PASS — 9 tests. |
| `python -B curriculum_api/test_session_media_no_db.py` with backend and curriculum_api on PYTHONPATH | PASS — 11 tests, including preserving trusted Bunny metadata across Graph refresh/re-issued IDs and rejecting an injected reference. |
| Focused Bunny/live-session/source-selection suites | PASS — 49 tests; journal migrations applied only to new SQLite `:memory:`, external sockets blocked. |
| `python -B -m curriculum_api.run_video_import_tests` | PASS — 157 tests. The newer-file fixture now has an explicitly later request timestamp; its assertion and production ordering logic are unchanged. |
| Expanded safe backend subset below | PASS — 61 tests, SQLite aliases verified as `:memory:` before Django setup; external sockets blocked after setup. |
| `python -u -B .qa-tmp/live-bunny-qa-20261105/run_pg_checks.py` from the repository root | PASS — 71 PostgreSQL integration cases, zero failures/errors/skips. Task-local harness and private database state are excluded from Git. |
| `git diff --check` | PASS, with Git's LF/CRLF normalization notices. |

Frontend feature command:

```powershell
npm --prefix frontend run test -- src/components/feature/BunnyRecordingVideo.test.tsx src/components/feature/SessionRecordingPlayer.test.tsx src/components/feature/SessionResults.test.tsx src/pages/curriculum/shared/entities/__tests__/liveSessionArtifacts.test.tsx src/pages/curriculum/recordings/__tests__/recordingsPage.test.tsx --maxWorkers=2
```

The expanded backend subset uses `config.settings_coaching_recordings_test`,
replaces both database aliases with fresh SQLite `:memory:` before setup, and
runs these suites under an outbound `socket.socket.connect` block:

- `curriculum_api.tests.TeamsMultiDayRecurrenceTests`, `TeamsAttendanceRosterTests`;
- `coach_api.tests_errors`;
- `learner_api.tests.TeamsAttendanceEligibilityTests`, `TeamsAttendanceSyncTests`;
- `curriculum_api.test_recording_views_no_db`, `test_session_recordings_audit`, `test_session_cloud_archive_no_db`;
- `coach_api.tests.CoachTimetableWindowTests`, `CoachTimetableBookingConflictTests`, `CoachMeetingArtifactTests`.

The error-handling case logs its deliberately blocked database attempt; the
suite still passes without connecting to an application database.

The previously blocked PostgreSQL integration suites now **PASS**:

- `curriculum_api.tests.CurriculumTeamsMeetingTests` — 21 cases;
- `curriculum_api.tests.TeamsCalendarSyncVerdictTests` — 10 cases;
- `coach_api.tests_calendar_race.CoachCalendarRaceTests` — 16 cases;
- `coach_api.tests_security.CoachAuthorizationSecurityTests` — 24 cases.

The task-local harness ran the established `login.test_runner.EnrolmentTestRunner`
against PostgreSQL 18.6. A read-only preflight verified the exact temporary
cluster data directory, role, port and database before any writes. The template
held a schema-only snapshot of 15 application namespaces and migration
bookkeeping; no learner/application rows, foreign tables, foreign servers,
replication subscriptions or external-call routines were copied. Hosted-only
and unrelated extensions were excluded; required `citext`/`pgcrypto` remained.
Both Django aliases used the new local test database, the full migration graph
ran, and outbound Python sockets were limited to that exact PostgreSQL endpoint.
Real Graph, mail and storage calls were blocked. The 71 cases completed in
43.807 seconds with no failures, errors or skips. The runner dropped its test
database, and the temporary server was stopped afterwards. The application
database was used only for read-only schema/migration metadata export, never
as the target of a test runner.

The follow-up changed only the file-choice test fixture and this validation
documentation. No Teams implementation file changed, so the previously passing
147-case frontend Teams baseline was not rerun unnecessarily.

**Release authorization, 5 November:** the owner reports uploading the combined
Microsoft Graph/Bunny dotenv and requests the existing branch be merged through
the normal review and CI/CD flow. This supersedes the earlier draft hold.
Independent inspection of AWS runtime secret mappings remains unavailable from
the local session; report post-deployment results separately from local checks.

Live meeting creation/invitations: **NOT RUN**. Browser learner playback:
**NOT RUN**; the connected computer-use runtime had no accessible browser.
The public main branch contains the prior curriculum Bunny integration, but
does not yet contain this live-session handler. No release of this change has
been performed.

Authorized live execution completed for the four selected recordings in four
module deliveries: all four were fetched directly from verified SharePoint
sources and reached Bunny encoding status 4. Read-only checks confirmed the
programme collection and module/occurrence/component/week metadata for each.
Every signed iframe returned HTTP 200; every HLS playlist returned HTTP 200 with
a decoded M3U header; every staff MP4 request returned HTTP 206 with an MP4
header. These are provider HTTP checks, not a learner browser acceptance test.

All four original Azure archive references and pre-existing artifact metadata
were compared with the private pre-change backup and retained. Only the four
empty, failed upload placeholders created during this task were removed after
the complete Bunny copies passed verification. No original Azure/SharePoint
file was deleted. The scoped journal and ready pointers are saved in the
configured application database; no schema changes were applied. The reviewed
application release and AWS runtime configuration remain outstanding.

## 5 November 2026 — combined release verification

The owner requested consolidating the Microsoft recording-access diagnosis with
the Bunny work on `feature/learner-active-modules`, then merging through CI/CD.
`origin/main` at `38f15f16` was merged into that existing branch without conflicts.
No branch/worktree was created or switched, and private dotenv files remain
ignored. The combined private handoff contains all seven Bunny/Graph variables;
their values match the local backend configuration. The owner reports uploading
that handoff to AWS; this session has not inspected its actual ECS mappings.

Final implementation-state checks after that integration:

| Check | Result |
| --- | --- |
| `npm --prefix frontend run test:teams` | PASS — 147 tests, 9 files. |
| Coaching recordings, quality-review APIs, Bunny/session players, recordings page and router Vitest suites | PASS — 491 tests, 36 files; React act warnings remained visible. |
| `npm --prefix frontend run type-check` | PASS. |
| `npm --prefix frontend run lint` | PASS. |
| `npm --prefix frontend run build -- --outDir E:/LMS_v2/.qa-tmp/recordings-integration-20261105/frontend-build` | PASS — 4438 modules, 33.02 seconds; library eval/chunk/plugin warnings remained visible. |
| Coaching recordings/quality/reminder backend modules | PASS — 465 tests across the 20 existing modules listed in the coaching operations guide, isolated SQLite with provider doubles. |
| Expanded SQLite Teams subset listed above | PASS — 61 tests, each module in a separate process with in-memory aliases and external sockets blocked. |
| `python -u -B .qa-tmp/live-bunny-qa-20261105/run_pg_checks.py` | PASS — 71 PostgreSQL cases, zero failures/errors/skips; exact local cluster verified before writes and stopped afterward. |
| `python -B -m curriculum_api.run_video_import_tests` | PASS — 157 tests, using the exact three pinned video dependencies in a private temporary test-dependency directory. |
| Session-results/library/reviewer no-database runners | PASS — 148/35/9 tests. |
| `python -B curriculum_api/test_session_media_no_db.py` | PASS — 11 tests, including server-owned Bunny metadata preservation. |

The legacy native-recording queue fixture had supplied the same fresh row to
both the fresh-candidate query and the failed-upload retry query. It consequently
entered an unintended mocked ORM iteration and timed out. Both that fixture and
the relevant production functions were unchanged from `origin/main`, verified
by AST comparison before editing. The fixture now provides separate fresh and
empty-retry results and asserts both SQL predicates, parameter lists and the
single native result. All 31 calendar-media tests pass; no production queue
logic or assertion was removed to obtain that result.

The transport suite's seven cases pass with its existing strict socket guard:
Windows first creates the internal asyncio loopback socketpair, then the suite
forbids application sockets and mocks Microsoft transport. An extra outer
blanket socket guard had blocked that standard-library setup; it was removed
only from the task-local invocation, without changing the suite or transport.

Read-only checks of the four existing cutover imports found all four saved as
ready, fully encoded on Bunny, in the expected collections with matching module,
occurrence, component and week metadata. All four signed iframe requests returned
HTTP 200. No additional media was uploaded or deleted by this follow-up.
The coaching snapshot still contained five retained `evidence_unavailable`
failures before deployment. Correct local Graph credentials had successfully
read one of those same meetings and its recording metadata; an explicit
**Refresh calendars** after fresh AWS tasks is needed to request an immediate
recheck of the old paused failures. These provider checks do not prove playback
from an authorized learner browser or the AWS runtime credential selection.

The preceding main CI run passed its build/test/security jobs but rolled back
after consecutive 5xx error-rate breaches during the deployment watch. The new
release retains that watch and rollback behavior. No live meeting/invitation
test or production database migration was performed in this follow-up.
