# Sequential implementation prompt — session recordings

Approved scope: automatic discovery and saved-result refresh; clear occurrence labels; staff hide/restore of accidental recordings; attendance PDF; explicit module-save labels; timed transcript below each recording. Applies to Module Builder, sessions dialog, preview and authorized learner playback.

Owner handles deployment and server scheduling. This plan completes and tests each **code** stage before starting the next. Production scheduling and full Django integration tests remain separate acceptance gates, not claims inferred from mocked tests. This supersedes the older execution prompt's unapproved-feature exclusions for the features approved in this task.

Rules: follow AGENTS.md. No commits, pushes, pulls, PRs, migrations, live writes, meetings/options/invitations changes, or credential edits. Preserve attendance eligibility and historical evidence. Never fabricate a transcript or match unrelated runs by array position. Keep videos private and enforce visibility on the server. Do not re-upload ready videos. New schema SQL, if necessary, is handed to the owner and never executed here.

Execute in this order; fix and pass the focused regression checks for the active stage before continuing:

1. **Automatic processing:** discover linked meetings regardless of planned date, bounded worker processing/retries and existing scopes; refresh saved reads without disrupting playback, overlapping requests, or polling hidden tabs. Test early recordings, ready-file reuse and auto refresh. Server activation is owner-run.
2. **Session identity:** show lecture title and scheduled/actual dates, distinguish empty sessions from processing, help staff find other sessions with saved files. Preserve existing occurrence bindings; do not move historical recordings automatically.
3. **Recording visibility:** retain every file, add staff hide/restore, block hidden recordings and associated transcripts in learner APIs/downloads and preview. Preserve staff review and archive idempotency. Test role and series boundaries, persistence across resync.
4. **Attendance PDF:** export lecture title, planned and actual run times, participant names, join/leave intervals, duration and attendance status from saved evidence. Preserve CSV and staff-only full roster. Verify PDF content and pagination visually with synthetic data.
5. **Save labels:** clearly label module structure saving; do not change persistence/autosave behavior. Run authoring save regression checks.
6. **Timed transcript:** parse saved WebVTT, associate only the matching recording/run, highlight and scroll active text under its video, allow seek from cue, handle pause/seek/multiple recordings and missing transcript. No Graph calls from playback or fabricated timings. Test authorization and timing boundaries.

Final gate: Teams baseline, feature tests, isolated backend checks, type-check/lint and build (record pre-existing failures), final diff. Full Django/DB and actual deployed learner playback require an authorized environment. Report deployment prerequisites separately.

## Execution log

- Initial state: clean worktree. Teams baseline: 71/71 PASS.
- Stage 1 code: PASS — 16 frontend tests; 58 isolated backend tests. Both worker entrypoints discover linked meetings without a planned-date cutoff; visible pages refresh saved reads every 30 seconds and on return. Ready videos are reused. Owner must deploy and schedule **one** curriculum worker every five minutes using `python manage.py process_session_results --scheduled --limit 10` from the backend environment (or retain the existing legacy scheduler entrypoint, not both). This was not activated against live data.
- Stage 2 code: PASS — 24 frontend tests and 58 isolated backend tests. Added lecture/scheduled/actual labels and navigation to other saved occurrences. Historical associations remain unchanged.
- Stage 3 code: PASS — 26 frontend tests, 61 session endpoint/worker checks, 4 media-policy checks, and 33 + 27 + 17 expanded isolated Teams checks. Visibility uses existing artifact metadata under a row lock; no new schema. Hidden media and related/ambiguous transcript downloads are denied by learner endpoints. Previously issued Azure SAS links remain usable until their existing expiry; hiding cannot revoke a URL already issued.
- Stage 4 code: PASS — 4 real PDF generation/extraction tests, 34 endpoint/evidence checks and 21 frontend checks. Rendered both pages of a synthetic PDF and inspected layout. Staff export includes lecture, planned/actual run dates, all saved visits, deduplicated total duration and status; existing CSV retained. Uses ReportLab already declared in backend requirements; no dependency changes.
- Stage 5 code: complete — module-save labels clarified; autosave suite PASS 16/16. Archived-programme suite has 3 existing failures (duplicate `Authored Week One` text in its unscoped selector); reproduced all 3 using the original HEAD page through a temporary Vitest loader, with no source rollback or weakened assertions. This separate regression gate remains unresolved.
- Stage 6 code: PASS — timed transcript below each video, current speech highlighting, panel-only auto-scroll, follow toggle and click-to-seek while preserving pause. Separate recordings retain their own transcript and playback during saved-result refreshes. Saved WebVTT is parsed once into existing database metadata; older transcripts are backfilled from their existing Azure copy by the worker without re-uploading ready videos. Missing text/timing remains explicit. Graph identifies matching recording/transcript pairs through [contentCorrelationId](https://learn.microsoft.com/en-us/graph/api/resources/calltranscript?view=graph-rest-1.0); fallback requires the same call and overlapping recorded times. Explicitly different correlations never pair. Signed offsets documented in [Graph transcript content](https://learn.microsoft.com/en-us/graph/api/calltranscript-get?view=graph-rest-1.0) are preserved. Alignment uses the saved transcript/recording start instants; actual sound/text alignment on deployed Microsoft recordings still needs a live playback check.

## Final validation — 16 September 2026

All commands below ran locally with mocked transport/storage or pure in-memory PDF processing. No live sync, database provisioning, credential change or deployment was performed.

| Check | Exact command | Result |
| --- | --- | --- |
| Teams baseline | `npm --prefix frontend run test:teams` | PASS, 71 tests / 9 files, before and after implementation |
| Connected feature checks | `npm --prefix frontend run test -- src/components/feature/SessionRecordingPlayer.test.tsx src/components/feature/SessionResults.test.tsx src/hooks/__tests__/useSavedSessionData.test.tsx src/pages/curriculum/module-builder/__tests__/learnerPreview.test.tsx src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/learner/video-watch src/pages/learner/attendance --maxWorkers=2` | PASS, 156 tests / 20 files |
| Session API, authorization, archive, worker, attendance | `python -B backend/curriculum_api/test_session_results_no_db.py` | PASS, 64 tests |
| Media pairing, visibility persistence, VTT parser | `python -B backend/curriculum_api/test_session_media_no_db.py` | PASS, 9 tests |
| Expanded calendar checks | `python -B backend/curriculum_api/test_calendar_checks_no_db.py` | PASS, 17 tests |
| Expanded calendar state | `python -B backend/curriculum_api/test_calendar_state_no_db.py` | PASS, 27 tests |
| Expanded calendar actions | `python -B backend/curriculum_api/test_calendar_actions_no_db.py` | PASS, 33 tests |
| PDF generation and extraction | `backend/.venv/Scripts/python.exe -B backend/curriculum_api/test_session_pdf_no_db.py` | PASS, 4 tests; two rendered synthetic pages visually inspected |
| TypeScript | `npm --prefix frontend run type-check` | FAIL, the same 41 pre-existing diagnostics before/after; no added diagnostics after normalizing line numbers |
| Lint | `npm --prefix frontend run lint` | FAIL, the same 133 errors / 113 warnings before/after; normalized diagnostic diff is empty |
| Build | `npm --prefix frontend run build -- --outDir "$env:TEMP\LMS-session-enhancements-20260916\frontend-build"` | PASS, built in 19.41 seconds; output outside repository |
| Diff whitespace | `git diff --check` | PASS |

Additional authoring gate: `npm --prefix frontend run test -- src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/curriculum/module-builder/__tests__/moduleBuilderArchivedProgramme.test.tsx --maxWorkers=2` returned 16 passes and 3 failures. All three archived-programme failures were reproduced with the original HEAD page using a temporary Vitest loader. Their existing unscoped `findByText('Authored Week One')` matches two elements; assertions were not changed or skipped. The autosave suite also passed in the final connected-feature run above.

**Expanded Django integration: BLOCKED / NOT RUN.** The existing Django runner creates schemas/data. Under AGENTS.md section 3, it cannot run against the configured database. Owner must provide/authorize an isolated database-backed environment for `TeamsMultiDayRecurrenceTests`, `TeamsAttendanceRosterTests`, `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests`, and the applicable coach retry/security and learner attendance suites. The isolated checks above do not replace this gate.

**Live Teams and browser playback: NOT RUN.** No verified local database-backed server was started. Tests verify timing logic, saved reads, ownership and retry behavior with doubles, not deployed Microsoft permissions, worker uptime or actual audio alignment.

## Owner activation and acceptance

1. Deploy the changed backend and frontend together using the existing environment and requirements. No new migration or schema SQL is required by these enhancements; the earlier session archive/job tables must already exist.
2. Schedule one worker every five minutes from the backend environment: `python manage.py process_session_results --scheduled --limit 10`. If the existing `sync_teams_meeting_artifacts` scheduler is already active, deploy its updated code and retain that single scheduler instead. Keep existing private Azure and Graph configuration. This step performs real imports/writes and was not run during this task.
3. Allow the worker to process old and new results. It reuses ready recordings, backfills old transcript timing from Azure once, and records each new Graph artifact under its stable identity. Visible LMS pages refresh saved database results every 30 seconds without re-importing or restarting the video. A meeting without a Teams transcript cannot display invented text.
4. Review the correct occurrence: historical `khalido 16` recordings belong to Session 6; Session 1 remains a different session. The sessions dialog now points to other occurrences with saved files. Historical evidence was not moved.
5. Verify with an authorized learner account: two recordings remain distinct; the active transcript follows playback and seeks correctly; hidden recordings/transcripts cannot be newly fetched; the staff attendance PDF has the lecture/date/visits; viewing results does not save the module or re-upload a video. Existing signed URLs can remain usable for their current four-hour lifetime after a recording is hidden.

Acceptance remains conditional on resolving the existing validation failures and completing the database-backed/deployed checks above. All implementation changes are local and uncommitted.
