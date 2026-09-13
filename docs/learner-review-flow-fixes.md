# Learner creation, assignment and review flow checks

Checked on 2026-09-12. Existing workspace edits were preserved.

The later complete readiness run and resolved test/type-check failures are recorded in [learner-launch-readiness.md](learner-launch-readiness.md). The dated verification results below describe the earlier runs.

## Confirmed problems fixed

| Step | Failure | Result |
| --- | --- | --- |
| Create learner | A successful save awaiting a manual invitation referenced an undefined `created` variable. The catch handler reported failure and skipped `onCreated`/closing the form. | The returned learner updates the directory and the form closes with the correct invitation message. The identical employer-creation failure is fixed too. |
| Change placement or learning plan | Shared learner reads were invalidated, but the calendar's separate snapshot survived. | Programme, placement and module-assignment changes also expire cached calendar events, including older pending snapshots. |
| Open Progress Review | The actual programme-session list was hidden by CSS while its counts remained visible. | Programme sessions, dates, statuses and links are visible; imported records retain their own labelled history. |
| Open Monthly Coaching | The actual sessions were hidden and counts came exclusively from imported history. | Counts and the visible session list use the same programme events. New learners do not need imported history. |
| Load or refresh reviews | A failed learner-detail/history request suppressed valid sessions. Progress Review silently swallowed calendar errors. | Sessions load independently; errors have a retry action. Returning to the tab refreshes bookings while retaining the displayed records. |
| Follow learner links | Monthly Coaching ignored an explicit learner query and omitted it from outgoing links. | List, detail, calendar and back links preserve the selected learner. A signed-in learner's identity continues to take precedence. |
| Follow an old review link | A missing requested review silently selected another review. | The page reports that the requested review is unavailable. |
| Read completed sessions | Completed/cancelled sessions offered Schedule or Reschedule. | These sessions link to their calendar record without suggesting a new booking. |
| View or export review slides | Slides after the cover used a hardcoded Marketing programme and default employer. OTJ position read a nonexistent field. | All slides use the deck's programme/employer metadata; missing metadata is labelled unrecorded. OTJ position reads `completedHours`. |

## Verification

- Focused frontend run: **38 passed**, covering creation completion, placement selection, review pages/history, calendar freshness and assignment-cache propagation.
- Final page/slides run: **98 passed**, including every learner page's empty/error rendering matrix, the review PPTX modal, slide metadata and the exported PowerPoint XML.
- Broader learner suite: **864 passed, 3 failed** across 88 files. The three failures are in the untouched `SidebarAdminPreview.test.tsx`, all expecting a `Platform Report` secondary-navigation link. This is not a fully green suite.
- Database-free backend suites: **237 passed** (151 + 86). Coverage includes module assignment and removal, borrowed programmes, content added after assignment, plan/profile synchronisation, learner identity and invitation readiness, placement dates, dashboard metrics, current review cycles and stored bookings, activity, assignments and access gates. Two existing test files were updated to mock unrelated database calls explicitly rather than reaching an unavailable connection.
- Production frontend build: **passed** after the implementation changes.
- TypeScript: repository-wide checking has unrelated existing failures; see the remaining-check notes below. No full type-check success is claimed.

Useful frontend checks from `frontend`:

```powershell
npm run test -- src/pages/users/components/__tests__/creationCompletion.test.tsx src/pages/users/components/__tests__/learningPlanPlacement.test.tsx src/pages/learner/reviews src/api/__tests__/learningPlanPropagation.test.ts src/api/__tests__/learnerCalendarFreshness.test.ts --maxWorkers=2
npm run test -- src/pages/coach/progress-reviews/components/__tests__ src/pages/learner/__tests__/pages.test.tsx --maxWorkers=2
npm run test:learner
npm run build
npm run type-check
```

Backend checks used the ordinary Django `DiscoverRunner`, only `SimpleTestCase` suites, with `DJANGO_USE_SQLITE=true`, `AZURE_MAIL_ENABLED=false`, and `CURRICULUM_WARM=0`. No database was provisioned and no migrations were run.

## Limits and remaining checks

No browser connection was available. These are rendered-component, simulated API and database-free backend checks, not a live create/assign/sign-in run against Neon. No real learners were created, no invitations were sent, and no database data or schema was changed. These fixes require no SQL.

The final TypeScript run reported 10 errors, all outside the changed implementation/test files: `features/monthly-logs/MonthList.tsx` (the summary month type), `pages/admin/users/AccessPanel.test.tsx` (missing `isSelf`), `pages/curriculum/programme-detail/SessionsTree.tsx` and `pages/curriculum/teams-meetings/page.tsx` (duplicate attributes/properties), and `pages/learner/evidence/historicalEvidence.test.tsx` (unsupported query options). Concurrent calendar work was present in the workspace during verification and was preserved.

No commits, remote Git operations or pull requests were created.

## Follow-up: future My Learning months (2026-09-13)

Native component metadata used `created_at` as the activity date, grouping a programme uploaded together under September. The learner now uses the same complete week/session planner as Module Builder, including multiple delivery days and selected cohort holidays. Explicit session dates and dated titles retain their placement; other components inherit their week's date. Empty weeks still consume their delivery slots, and authored weeks beyond the stored session count are included. Unscheduled content stays undated. Historical date handling and completion totals are preserved.

The scheduling reader selects only date-related component settings and reads cohort holidays without schema initialisation. Older cached creation-date metadata can no longer override a native session date in the frontend. No SQL or data repair is required.

A subsequent read-only check against the configured database verified the exact module in the screenshot: **Marketing Impact and Planning**, with **345 components across 32 authored weeks**. Running the new scheduling reader returned all 345 components: October 2026 (44), November (45), December (25), January 2027 (42), February (42), March (20), April (62), May (43), June (22). None fell under September because of creation timestamps. Both database connections were restricted to read-only transactions for this check; no learner records or curriculum data were modified. This was a database/API-data check, not a live browser walkthrough.

Follow-up validation: **61 distinct database-free backend tests passed**, including 9 new native scheduling tests; **46 My Learning frontend tests passed**; production frontend build passed. Regression coverage includes a 345-component plan, future months across a year boundary, holiday shifts, two delivery days per week, empty weeks, 32 authored weeks against a stored 16-session count, explicit/UTC dates, Introduction, removed weeks and completion totals.

## Follow-up: assigned work in the Assignments tab

The tab previously requested only classified historical submissions, so an assigned component disappeared until the learner had a historical record. It now also reads the current learner's assigned components from the same training-plan payload used by Quizzes. The assigned list shows the module, week, planned delivery date and current submission status, with All / To Do / Submitted / Completed filters. Start, continue-draft and revise links open the existing assignment submission wizard. Status and date requests are independent of historical submissions, so a history outage cannot hide assigned work. Returning to My Learning refreshes the training plan, and removed assignments leave the list.

Read-only inspection of the screenshot's module found **six assignment components with no brief, content, description or attached resource**; their only reflection text was the standard seeded prompt. These components remain visible with **Awaiting brief** and an explanation. Authored text or an attached document enables the action. No task questions were invented and no database records were changed; the assignment author needs to supply the missing brief/materials.

Validation: **13 assignment-list tests**, **10 submission-wizard tests**, **2 shared loading tests**, and **1 My Learning page/navigation integration test** passed; the production frontend build also passed. Coverage includes work with no previous submission, drafts and returned work, status/history failures, missing briefs, document-only assignments, removed/duplicate IDs and learner-specific routes.
