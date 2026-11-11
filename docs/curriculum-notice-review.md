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

## Validation and release gate

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
