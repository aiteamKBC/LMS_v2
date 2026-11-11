# Curriculum notice review — 11 November 2026

The review covers yellow notice and warning markup across `frontend/src/pages/curriculum`, its shared schedule components, and the connected learner curriculum views. The initial static search found 366 colour/alert references, including ordinary status badges and content-type colours; these are not 366 errors. This is a source review and automated regression review, not a live check of every curriculum screen or Microsoft integration.

The requested outcome is a calmer, readable interface for learners and staff, with important next steps still visible. Familiar navigation, form values, access windows, dates, meeting identities, attendance, recordings, progress and published learner notes remain governed by the existing code.

## Changes

| Area | Presentation change | Behaviour preserved |
| --- | --- | --- |
| Course structure and module workspace | Link activity outside a session starts collapsed. Same-day activity is no longer described as happening on another day. | Every event, exact time and exclusion explanation remains available; attendance classification is unchanged. |
| Holiday notices and calendar views | Named holidays use a quiet calendar treatment. Optional details open on request. Text and controls are larger. | Holiday selection does not automatically move, cancel or remove sessions. Author notes retain their text, publication switch and validation. |
| Copied KSB report | Repeated links are grouped by code, with every reason retained and an action to review current mappings. | The saved report and current mappings are unchanged. The report is identified as historical copy information, not a current count of distinct missing skills. |
| Missing dates and calendar differences | A short explanation and a clear review action replace large warning blocks. Detailed comparisons remain available. | Missing dates, partial integration results and schedule differences remain visible; no Microsoft changes are sent automatically. |
| Learner data loading | Contextual, plain-language failure messages and retry actions replace raw server/transport text. Known missing-module and access-denied states retain their meaning. The new upcoming-learning retry requests the failed list directly. | Failure states, protected-content gates, saved content and progress remain intact. Upcoming reads retain the existing learner guard and transport retry; they do not refresh the whole catalogue. Submission validation messages are not globally replaced. |
| Reading weeks and learner holiday notes | Neutral/purple information styling and more readable text replace warning-style holiday surfaces. | Learners see only the notes already published for their own week. |

Normal status badges, readiness indicators, validation feedback and real action-required warnings were reviewed separately from informational notices. They were not removed through a global colour substitution. The new shared `Notice` component keeps the message, next step, optional detail and severity distinct.

## Other yellow messages reviewed

| Message family and source | When it appears / meaning | Disposition |
| --- | --- | --- |
| Missing KSB source or standard — `programmes`, `ksb-mapping`, `ifate-standard`, Module Builder | A programme has no usable required KSB set, or a standard cannot be linked. Coverage cannot be interpreted normally. | Keep the action-required warning and source selection. Choosing or remapping a standard requires a programme decision. |
| Untaught KSBs and readiness — `ksb-mapping`, `programme-detail`, Module Builder | Content has not been mapped, required fields are unfinished, or readiness is incomplete. | Retain the warning/count. These are authoring tasks, not evidence of a broken integration. |
| Archived records and simultaneous edits — Module Builder, archive views | An archived parent blocks editing, another author saved, or a merge needs attention. | Preserve the warning, recovery controls and read-only restrictions. Do not dismiss or overwrite another author's work automatically. |
| Unsupported legacy video or refused iframe — Module Builder; unavailable content previews — `programme-detail` | A saved source cannot play or embed, or historical content was renamed/deleted. | Retain the explanation and existing replacement/open/retry action. A replacement media source cannot be guessed. |
| Missing or unverified Teams meetings, connection checks, partial invites/cancellations, orphaned slots — Teams dialogs and module sessions | Microsoft verification or a requested operation is incomplete, or the plan and calendar disagree. | Preserve every failure and recovery control. The new presentation does not imply that Microsoft accepted a local save. No live repair or sync was performed. |
| Background worker paused / processing gaps — `knowledge-base` | Queued book processing cannot currently finish, or content has gaps. | Keep the operational warning and review controls. The conditional code alone does not prove a live outage. |
| Coming soon / missing capability — `hubs` | A feature is not available yet. | Retain the availability information; do not fabricate an integration. |
| Week-template, preview and other staff load failures | A read failed and the page needs retry or investigation. | Keep honest failure states. The learner-facing load states covered by this change use safe, contextual copy. |
| Assignment/content type colours, pending statuses, progress and QA badges — other curriculum lists | A category or workflow status is being distinguished. | Retain existing colours and meanings; these are not error banners. |

## Findings requiring a separate decision or investigation

1. In the original live example, a holiday period and the date displayed for the first week did not line up. The UI can be reading the planned slot and the booked session date from different places. No dates or holiday assignments were rewritten; this needs confirmation of the intended plan before a scheduling fix.
2. A KSB copy report does not prove which links are still missing today. No links were inferred or remapped across standards. Review the existing mappings against the destination programme before any data repair.
3. Three existing tests in `recordedCourseProgress.test.tsx` fail for completed standalone quiz reviews (commercial and apprenticeship) and a recorded activity's catalogue link. A read-only Vitest loader that supplies the original `HEAD` versions of modified source files reproduced the same three failures (16 passed, 3 failed). No branch, checkout, test expectations or implementation for those cases was changed to hide the failures. This evidence establishes an existing test failure, not a confirmed live learner defect.
4. Code paths for unavailable calendar integrity history, incomplete Microsoft verification and unavailable version history remain genuine configuration/integration states. Their existence in source does not establish that the deployed service is misconfigured. No schema repair, Graph sync, invitation, email or live external operation was attempted.
5. The existing historical-evidence test `retries document preparation without losing the evidence details` also fails on the original `HEAD` sources (10 passed, 1 failed). It expects a single transient 503 to remain visible although the shared transport retries it. Neither that test nor the document preparation flow was changed in this task.

## Initial validation and release gate

- Frontend Teams baseline: **PASS**, `npm --prefix frontend run test:teams`: 9 files, 149 tests. The holiday-copy assertion now checks the intentionally collapsed, keyboard-accessible date details; the unchanged schedule and no-cascade assertions remain.
- Feature checks: **FAIL**, 28 files, 539 passed and the same 3 recorded-course tests failed. The unchanged `HEAD` comparison reproduced all 3 failures (16 passed, 3 failed). Coverage includes notice disclosure, learner-note editing/publication, grouped KSB reporting, privacy of learner-facing errors, allowed/forbidden dashboard views, retries, retained progress, course structure, authoring saves, learner preview and connected learner views. An earlier intermittent reading-highlight assertion passed on both the original-source comparison and the resumed feature run; it is not classified as a confirmed existing defect.
- After the final upcoming-retry change, `npm --prefix frontend run test -- src/pages/learner/my-learning/compactModules.test.tsx src/pages/learner/home src/pages/learner/attendance src/pages/learner/evidence --maxWorkers=2`: **FAIL**, 13 files, 207 passed and the existing historical-evidence assertion failed. All 30 compact-module tests passed, including direct retry and retained catalogue checks for both learner types. The dashboard consumer suites also passed (37 tests) after the retry extraction. Counts from these overlapping runs must not be added together as unique coverage.
- Type check: **PASS**, `npm --prefix frontend run type-check`.
- Lint: **PASS**, `npm --prefix frontend run lint`.
- Bundle: **PASS**, `npm --prefix frontend run build` (build emitted eval, chunk-size and plugin-timing warnings).
- Backend checks used a temporary verified runner with both Django database aliases set to SQLite `:memory:`, local-memory mail and outgoing application network calls blocked. Only Windows event-loop internal socket creation was permitted. It ran the unchanged `TeamsMultiDayRecurrenceTests`, `TeamsAttendanceRosterTests`, `TeamsAttendanceEligibilityTests`, `TeamsAttendanceSyncTests` and `CoachErrorSecurityTests`: 20 passed, with no test databases used.
- From `backend`: `.venv/Scripts/python.exe -B curriculum_api/test_off_schedule_runs_no_db.py`: 8 passed.
- Full PostgreSQL-dependent booking/race/ownership and curriculum meeting/sync-verdict integration suites are **BLOCKED / NOT RUN**: no verified isolated PostgreSQL test environment is available for this task. The local SQLite runner is not presented as a substitute for those integrations.
- A synthetic local preview was prepared with no application/backend proxy. Computer Use stopped before visual validation because it could not confidently verify the browser URL, including on the resumed attempt. Visual review is **BLOCKED / NOT RUN**; the browser safety check was not bypassed.
- Live Microsoft Teams: **NOT RUN**.

No database/schema/data changes, dependency changes or deployment configuration changes are part of this change. The work stays on the current branch and requires review and the unresolved checks before acceptance or deployment from merged main.

Final command results are recorded with the pull request; this document does not claim complete validation while the blocked checks or existing failures remain unresolved.

The resumed feature command was:

```powershell
npm --prefix frontend run test -- src/components/feature/__tests__/learningNotices.test.tsx src/pages/curriculum/module-builder/__tests__/courseStructureMonths.test.tsx src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/curriculum/module-builder/__tests__/learnerPreview.test.tsx src/pages/curriculum/module-builder/__tests__/holidayReadingWeeks.test.tsx src/pages/curriculum/teams-meetings/__tests__/offScheduleRuns.test.ts src/pages/curriculum/teams-meetings/__tests__/offScheduleRunDetails.test.tsx src/pages/curriculum/teams-meetings/CalendarHealthPanel.test.tsx src/pages/learner/training-plan-timeline src/pages/learner/my-learning/compactModules.test.tsx src/pages/learner/my-learning/studentActivity.test.tsx src/pages/learner/my-learning/studentMaterial.answers.test.tsx src/pages/learner/my-learning/AssignmentsTab.test.tsx src/pages/learner/my-learning/recordedCourseProgress.test.tsx src/pages/workspace/learner/__tests__/DashboardCompactTraining.test.tsx src/pages/workspace/learner/__tests__/dashboardRequestGraph.test.tsx src/pages/learner/video-watch/completion.test.tsx src/pages/learner/video-watch/readingAccessibility.test.tsx --maxWorkers=2
```

## Pre-merge recheck — 11 November 2026

The owner requested another regression review and explicitly reserved PR merge and deployment for a later instruction. Neither was performed.

Concurrent work was active in the same working folder, including Module Builder, evidence, reflections and learner content. Validation therefore read tracked source directly from immutable Git objects into memory. No branch switch, worktree, reset, stash, alternate checkout or change to the teammate's source was used. Installed dependencies and existing test configuration were retained. The local validation adapters remain ignored under `frontend/.codex/curriculum-notice-validation/`; they are not application changes or replacements for the tests' assertions.

- Compared main revision: `71b3f1c7c2b315dcfdb83a6cec60604eca63713d`.
- Reviewed source commit: `b0c8d383` (the subsequent handoff change is documentation only).
- Simulated combined source tree: `a3a09f14c12ad96e7a3251764efdb996e99eaa7c`.
- `git merge-tree --write-tree --name-only HEAD 71b3f1c7c2b315dcfdb83a6cec60604eca63713d` produced a clean tree. Only moving this PR's `LearnerLoadError` import was needed to avoid the navigation import conflict. This does not merge either branch.

The review added two calendar regression cases: initial failure followed by retry, and a failed background refresh followed by recovery while saved sessions remain visible. Both assert that no schedule-update API is called. Two existing learner-page assertions were updated for the intentionally safe error copy; their access gate and recovery assertions remain, with new checks that raw transport text is absent.

| Check | Result and limit |
| --- | --- |
| Teams baseline, unchanged nine-file command with the pinned-source config | **PASS: 149 tests, 9 files.** All baseline cases ran. |
| Final feature/recovery checks | **162 passed, 20 failed, 5 files, no skipped cases.** All 20 failures also failed on main. Notice disclosure (6), compact learning (30), Module Builder saves (30), and calendar recovery (2) all passed. The wider learner-page suite passed 94 and retained the same 20 main failures. |
| Wider curriculum, learner and shared-consumer run | **5325 passed, 108 failed, 492 files, 5433 tests, no skipped cases.** This is not a green regression run. The run used the earlier combined tree `43659f1e3174544308d706bddfec186fbb7bb3b9`; the final tree differs only in the two test files described above. |
| Comparison of wider failures with main | **104 identical failing cases were reproduced on main** across 22 files (526 comparison cases). Two additional failures were the old error-copy expectations, now corrected and passing. A video-upload case and an onboarding-review timing case failed in the large run, then passed on recheck: the full save suite passed 30/30 and the review-lock suite passed 7/7. Their intermittent causes were not established or silently repaired. |
| Type check of final pinned source | **PASS: 2708 files, 0 diagnostics.** |
| Lint of final pinned source | **PASS: 2706 files, 0 errors/warnings.** |
| Production bundle of combined application source | **PASS.** Application source is unchanged between the bundle tree and final tree; only test files differ. Build emitted eval/plugin-timing and four asset-resolution warnings. The four assets are present in the combined Git tree but absent from the current working folder; this local validation output is not a deployment artifact. |
| Applicable backend Teams/attendance/security checks | **PASS: 20 tests** from the pinned combined backend source, with both DB aliases forced to SQLite memory, mail in memory and application networking blocked. No databases were provisioned or used. |
| Off-schedule no-database cases | **PASS: 8 tests.** |
| PostgreSQL-dependent meeting/sync-verdict and booking/race/ownership suites | **BLOCKED / NOT RUN.** Read-only settings inspection confirmed normal application DB endpoints and all three isolated-test flags disabled. A historical test URL exists, but no exact approved branch ID or local branch configuration is declared. No connection, SQL, schema or data change was made during this verification. |
| Visual check | **BLOCKED / NOT RUN.** Browser access host was unavailable. A local synthetic preview was prepared; no existing shared browser page was changed. |
| Live Teams | **NOT RUN.** No meetings, invitations, recordings, attendance or Microsoft settings were changed. |

The wider discovery covers the tracked test files present in this working folder. Four unrelated test files added on main (Global Search and three progress-transfer suites) were not present locally and were not executed or counted as passed. This is not a claim to have run the entire LMS test suite.

The baseline comparisons establish automated failures in the same runner, not 104 confirmed live learner defects. Uncommitted work in the shared folder is also outside this tested snapshot. In particular, `module-builder/page.tsx` and `LearnerPreview.tsx` have continuing teammate edits; preserve those and check integration again when that work is committed.

Pinned frontend checks used the existing Vitest configuration plus a read-only Git source loader:

```powershell
$env:NOTICE_REVIEW_TREE = 'a3a09f14c12ad96e7a3251764efdb996e99eaa7c'
npm --prefix frontend run test:teams -- --config .codex/curriculum-notice-validation/vitest.config.mjs
npm --prefix frontend run test -- --config .codex/curriculum-notice-validation/vitest.config.mjs src/components/feature/__tests__/learningNotices.test.tsx src/pages/learner/my-learning/compactModules.test.tsx src/pages/curriculum/session-calendar/__tests__/calendarRecovery.test.tsx src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/learner/__tests__/pages.test.tsx --maxWorkers=2
# From frontend:
node .codex/curriculum-notice-validation/checks.mjs types
node .codex/curriculum-notice-validation/checks.mjs lint
```

The wider command targeted `src/pages/curriculum`, `src/pages/learner`, `src/pages/workspace/learner`, `src/components/feature`, `src/hooks/__tests__`, `src/api/__tests__`, `src/api/reflectionSubmission.test.ts`, `src/features/old-otjh` and `src/router/__tests__`, with the same pinned config and two workers. JSON results and local logs remain under the task-specific `lms-notices-pr678-*` names in the Windows temporary directory.

**Acceptance remains blocked.** Resolve or explicitly review the recorded baseline/intermittent failures and complete the missing environment/visual checks before considering merge. Recheck current main and rerun affected checks if relevant source changes after this snapshot. The PR remains a draft; this report is not merge or deployment approval.
