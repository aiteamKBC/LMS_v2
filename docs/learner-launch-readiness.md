# Learner launch readiness — 2026-09-13

## Working brief

Follow a new learner from creation to assigned learning, completion and review. For every transition, check that the next page reads the learner's saved/current facts, that actions target the correct learner and component, and that successful mutations refresh affected views. Verify empty, loading, failure and retry states. Fix reproducible failures and add regression coverage at the failing boundary. Never replace absent curriculum content with invented questions or show another learner's data as a fallback.

The initial phase used read-only database diagnostics and isolated tests. The owner subsequently explicitly authorised live database writes for the learner walkthrough. The live phase below uses labelled QA identities and real local HTTP endpoints against the configured database. No migrations, commits or remote Git operations were performed.

## Authorised live walkthrough — 2026-09-13

The real browser harness is [learner-live-flow.mjs](../frontend/scripts/learner-live-flow.mjs). It uses Playwright/Edge with no API mocks, a Django server on port 8000 and Vite on port 3000. Credentials and diagnostic captures are kept only under ignored `.cache/learner-readiness/`; no passwords or invitation tokens are checked into source control. This is a stateful live test, not a script to run against arbitrary real learners.

Test learner **501** was created from the Users form. QA administrator **108** and QA coach **109** were used for staff actions. The learner was assigned Marketing Executive Level 4, October 2026 / G1, and the three existing modules (985 components, including 12 assignments). The cohort's stored start is **10 September 2026**, despite its October name. A separate labelled QA module supplied a reading activity, an assignment with a real brief, and quiz **4332** with a real question; it was assigned only to the QA learner.

After verification, QA sign-in accounts **195, 196 and 197 were disabled**, their passwords cleared, sessions revoked and unused invitations expired. Labelled learner 501, the draft QA module, accepted assignment, quiz attempts and booking/evidence records remain for review. The harness refuses to rerun these closed credentials; provision fresh explicitly authorised test identities for another live run.

| Actual operation | Verified result |
| --- | --- |
| Create learner and save learning plan in the UI | Account provisioned; programme, placement and three assigned modules reload from the database. |
| Invitation/password/sign-in | Own single-use invitation consumed through Set password; normal learner login succeeds. Email delivery was disabled. The test invitation token was obtained through the server invitation service, not through a received email. |
| Staff activation and coach assignment | Source and learner profile both become Active; current KSB definitions, 4 progress reviews and coaching/calendar events become visible. |
| Future modules | Real Marketing Impact and Planning month sections include October, November, December 2026 and June 2027. |
| Assignment | Enter answer/learning statements; save and reopen draft; save evidence link, programme KSB explanation, time and declarations; complete impact/action/reflection sections. All 13 real quality checks pass after booking and reviewed presentation export. |
| Presentation and submission | Actual PPTX download verified; submit persists; list opens the saved submission with disabled answer fields. |
| Coach return and acceptance | Normal coach login and CSRF-protected review API return the submission; learner sees Revise assignment and saves edits. Resubmission passes all checks. Coach acceptance reaches the learner and locks the accepted work. Coach decisions were API writes, not clicks through the coach marking interface. |
| Quiz | Real failed attempt followed by real passed attempt; both persist and the quiz list becomes Completed. The QA quiz was explicitly authored without an additional reflection. |
| Reading/time | Real content opens; entered 30 minutes selected in confirmation; completion/time survive reload. Final programme metrics show 3 completed activities and 1.5 actual OTJ hours. |
| Evidence | Upload the actual PPTX from Evidence; reload its metadata and library grouping; download from Azure and compare all bytes successfully. This proves storage/retrieval, not malware scanning. |
| Reviews/calendar | Open planned review/coaching details; book a progress review for 30 November 2026; reschedule to 11:30; confirm saved calendar time and refreshed review-list date. |
| Ownership and refresh | A learner session cannot read learner 499's detail, evidence or calendar (403/404); its curriculum refresh-counter request succeeds without exposing staff change paths. |
| KSB progress | Add an authored K1.1 mapping to the QA reading activity; verify the learner sees the mapping and metrics count the completed activity. |
| Other learner pages | Calendar, reviews, coaching, attendance, evidence and monthly logs render against actual learner-owned data. No claim of live attendance marking or monthly-log signatures. |

### Additional bugs reproduced and fixed by the live run

- An explicit staff status edit changed the source record without synchronising the profile used by reviews/coaching. Status edits now synchronise that profile.
- Default reflection boilerplate incorrectly made empty assignments and unlinked quiz placeholders look openable. Assignment tasks require actual authored content; unlinked quizzes remain unavailable.
- Learner polling received 403 from the curriculum refresh counter. Learners may now read the epoch, with staff change paths omitted.
- Creating sibling components could generate identical timestamp IDs on Windows. New IDs add a random suffix; existing IDs retain their identity.
- Editing one component read every curriculum component and timed out against the live database. Its read is now scoped to the component's module; the real edit was repeated successfully.
- A quick quiz attempt could finish before its authored reflection requirement arrived. Starting now waits for learner requirements, with retry on load failure. Deferred-response regressions cover this.
- Evidence metadata returned by raw PostgreSQL as JSON text lost its placement, description and KSBs in the UI. The API now normalises it to an object. The file picker also accepts the Word/PowerPoint formats supported by the upload API.
- The KSB metrics reader did not recognise the Builder's `ksb_code` field, so a valid mapping produced `activity_points_missing`. It now reads the canonical field; the live mapped activity increments KSB progress.
- Email fallbacks could reassign another learner's linked profile or combine unrelated progress IDs. Only unlinked legacy profiles with an unambiguous source email can be adopted; progress/evidence lineage uses explicit enrolment links first. Learners 499 and 500 remain separate and unchanged.

### Final automated checks for the live fixes

- **758 backend learner tests passed**; 32 database-dependent test cases excluded by the no-setup runner. Actual persistence is covered separately by the live walkthrough above.
- **29 API role-gate tests passed** (independent suite).
- **916 frontend tests passed across 92 files**, including the new quiz loading/retry regressions; **6 assignment/quiz content utility tests** also passed separately.
- TypeScript type check and production build passed. `git diff --check` passed.

### Remaining operational/content work

External invitation delivery and Teams meeting creation are **not certified**. Test emails use `example.test`, mail delivery was disabled, and Microsoft Graph could not create events for those test organisers. The local bookings persisted with an explicit warning. A valid Microsoft 365 test organiser/recipient is needed to verify actual delivery; this run does not establish that every real coach's calendar permissions work or fail.

The six empty Marketing assignment briefs still need the curriculum owner's choice of approved content; proposed questions are linked below. Unlinked quiz placeholders need real authored quiz questions/links. No unrelated quiz or generated question was silently assigned to real students. The previous aggregate of missing sign-in accounts and learner 500's duplicate email remain separate rollout work, not solved by one successful QA account.

The following sections retain the earlier isolated/read-only verification record; their counts and restrictions describe that earlier phase.

## Scenario

1. Create commercial and apprenticeship learners; validate required fields, duplicate/error handling, directory refresh and invitation state.
2. Assign programme, cohort, group, coach/tutor and modules. Confirm the learner sees their own current placement and that removing/reassigning modules updates all affected views.
3. Enter the learner workspace. Check programme/header, navigation, dashboard, progress and OTJ summaries without sample facts.
4. Open My Learning and every component type. Verify future month/week placement, titles, instructions/resources and links.
5. Open quizzes; test start, answer, submit, failed/passed results and refreshed list/progress.
6. Open assignments with no previous submission; start a written/file-based task, save/reopen draft, submit, review and return for revision. Incomplete authored content must remain visible with an accurate explanation.
7. Check evidence selection/upload states, completion/time capture and consistent totals without double-counting.
8. Check calendar, coaching and progress reviews: planned sessions, booking/rescheduling/cancellation, links, statuses and refresh after changes.
9. Check monthly logs, attendance and profile/document pages; errors must stay distinct from empty records.
10. Navigate between two learners and simulate delayed responses, API failure/retry and focus refresh. Verify ownership and read-only staff previews.

## Verification record

### Fixes confirmed during this run

- My Learning now stores the selected Modules / Quizzes / Assignments tab in the URL. Refresh, browser Back and links to another learning tab follow the selected page instead of retaining stale component state. Other query parameters, including the selected subject, are preserved.
- Corrected the monthly-log summary type so its month rows keep their historical/current source metadata. Removed duplicate Teams sync handler and invitation payload properties; corrected invalid test props/query options that blocked TypeScript.
- Updated stale navigation and programme-workspace test selectors to the current interface. Updated backend test fixtures to supply authenticated staff and isolate unrelated reads/synchronisation. Production authorisation and KSB-source priority were retained.
- Rechecked the earlier fixes for successful learner creation, plan/calendar refresh, current programme metadata, visible review/coaching sessions, full future-month component schedules and newly assigned work. Details and the read-only diagnosis are in [learner-review-flow-fixes.md](learner-review-flow-fixes.md).
- Calendar events and assigned coach now refresh when the learner returns to the tab or another session changes shared records. An open event dialog follows the updated record, and a failed initial load offers Retry calendar.
- An older background calendar response can no longer overwrite a booking/reschedule that has just succeeded. A deferred-response regression reproduced the old appointment replacing the saved one, then passed with the write-version guard.
- Calendar Previous/Next now advances by the selected day, week or month. Month changes clamp the selected day to the destination month, and weeks spanning December/January retain each day's year.
- Day/week views now show planned sessions with no confirmed time in an explicit section. The timeline expands for appointments before 07:00 or after 21:59, so those sessions remain visible and clickable.
- Booking and rescheduling calculate the timezone offset at the appointment date/time. The previous use of today's offset could shift a future appointment by an hour when it crossed a daylight-saving change. Regression tests reproduced the incorrect offset for both actions before the fix.
- Assignment validation clears an earlier successful result before rechecking and rejects incomplete/malformed check sets. A failed check request or an empty final response cannot enable submission using stale results. Both regressions failed before the fix and pass afterward.
- If a tutor removes an assignment's brief after work has been saved, the assignment list and activity route retain access to the existing draft/submission. The activity route verifies that saved work exists for the requested assignment, handles read errors with retry and ignores responses from a previously selected learner. A never-started empty assignment remains unavailable to start.

### Executed checks

| Check | Result and scope |
| --- | --- |
| Backend learner suite | **745 passed**. The runner discovers the learner API suite and selects only database-free SimpleTestCases. **32 database-dependent cases were excluded**, and no database setup/migrations were invoked. Includes assignment/removal/propagation, access, identity, dates, review cycles/bookings, activity/submission validation and invitation readiness. |
| Main frontend learner suite | **914 passed across 91 files** on the final implementation, including saved-work access after removal of an assignment brief, timezone and delayed-response fixes. Covers learner pages, shared APIs/hooks, navigation, calendars, assignments, evidence, progress and error/loading handling. |
| Saved-assignment access regressions | **91 passed across 7 files**, all included in the final main suite. Four list regressions reproduced the missing links; the browser then reproduced the activity-page content gate. The final flow opens existing saved work, retains the empty-assignment gate and tests read failure/retry and stale learner responses. |
| Calendar/submission regressions | **34 passed across 3 files** before the final full-suite run. These all overlap the 914 main-suite tests; they are not additional unique tests. |
| Final My Learning/page regression run | **160 passed**, including the additional URL/Back/deep-link regression and the learner-page empty/error matrix. These overlap the main suite; they are not an additional 160 unique tests. |
| Additional frontend checks | Users, placement, monthly logs and programme workspace: 135 initially passed; the three outdated programme selectors were corrected and all 12 programme-workspace tests then passed. The four learner-journey utility suites passed their 15 checks. Targeted admin-access/evidence/monthly-log/navigation checks also passed. |
| Production build | Passed after the calendar and submission changes. |
| TypeScript | Passed after the implementation and fixture fixes. |
| Offline browser walkthrough | Passed against the built app in a fresh headless Edge context. Every API request is intercepted; unmodelled requests fail closed and external requests are blocked. No real accounts, invitations, bookings or submissions were written. |

The browser walkthrough used the actual rendered application to:

1. Open Users and create a commercial learner with programme, cohort and group; verify the directory refreshes with the saved row.
2. Use Add learning plan, save the assigned module and verify Edit learning plan appears. The in-memory service refuses learner curriculum reads until this staff save has occurred.
3. Enter the learner view; choose Assignments and verify that a refresh retains the selected tab. Check newly assigned work and the separate Awaiting brief state; verify that directly entering an empty assignment's URL does not start a draft. Open the authored question, enter an answer, save the draft, return to the list, follow Continue draft and verify the saved answer.
4. Enter one hour, run the simulated quality service and press Submit assignment. Force a completion-service failure, verify the saved draft remains, retry and verify exactly one completion for the correct learner/component, a submission preview and the locked submission after returning from the list.
5. Simulate a coach returning that submission; use Revise assignment, edit the answer and save it again. Temporarily remove its authored brief, follow Continue draft from the list and verify that the saved answer remains available in the activity page.
6. Verify component month sections for October, November and December 2026.
7. Start and answer a quiz, submit a failed attempt, retry with a passing answer, return to learning and verify the completed list status.
8. Open two assigned progress reviews and an assigned monthly coaching session without imported records, then follow their detail links and verify the assigned coach.
9. Follow a progress-review scheduling link, force a booking failure, retry successfully, reschedule and verify the new date on the review list.
10. Simulate a later coach change while the calendar appointment is open, focus the tab and verify that the dialog updates.
11. Simulate removal of an assignment and addition of another while the learner list is open. Focus the tab, verify the list updates, open the new question and confirm it does not inherit the previous assignment's answer.

The extended run recorded **19 in-memory non-GET requests**, no unknown API requests and no browser runtime errors. Quality-check responses are simulated: the browser check verifies submission wiring, failure/retry and ownership, while the backend suite checks the real validation rules. Coach-return and later assignment/calendar changes are simulated server state changes, not actions in the coach interface. Evidence handling, cross-learner isolation, apprenticeship variants and other learner pages are covered by automated component/API/backend suites, not by creating live accounts. External services and every possible production button are not certified by this walkthrough.

### Re-run

From `backend`:

```powershell
./.venv/Scripts/python.exe scripts/test_learner_readiness.py
```

From `frontend`:

```powershell
npm run test:learner
npm run test -- src/pages/users src/features/monthly-logs src/pages/curriculum/programme-detail src/utils/learnerJourney.weekPosition.test.ts src/utils/learnerJourney.quizStatus.test.ts src/utils/learnerJourney.completionState.test.ts src/utils/learnerJourney.completionCriteria.test.ts --maxWorkers=2
npm run type-check
npm run build
```

For the browser check, start `npm run preview -- --host 127.0.0.1 --port 4318 --strictPort` in one terminal, then run `node scripts/learner-flow-smoke.mjs` in another. It uses installed Playwright Chromium/Edge/Chrome, or the `LEARNER_SMOKE_BROWSER` executable override. It never forwards an API request to the real backend.

### Content and live-operation limits

**Current login readiness is a release blocker.** A fresh read-only aggregate on 2026-09-13 found 371 learners: 3 Active and 368 Delivery. **368 have no linked login account** (1 Active and 367 Delivery). The other 3 have enabled accounts with passwords and sent-invitation records. A further identity check found learner **500** using the email already linked to account **194**, belonging to learner **499**. The owner has confirmed that these are **two different people** and will supply the correct email. Keep both records separate; neither learner/account was merged or reassigned. Learner 499 has the Marketing programme, October 2026 cohort and G1 placement; those fields are blank on learner 500.

[Exact owner-executed SQL](sql/learner-login-readiness-2026-09-13.sql) prepares the 367 unambiguous missing accounts with empty passwords, skips existing accounts/email conflicts and leaves programme statuses and curriculum unchanged. It was prepared against the inspected schema and was **not executed**. The owner must then review the records and send invitations from Accounts; account provisioning alone does not make the students ready to sign in. Learner 500 remains excluded until its identity/email is corrected.

Read-only inspection during this work found **six assignments in Marketing Impact and Planning without an authored brief, question or attached resource**. They now appear as Awaiting brief. The curriculum author must supply the real task before learners can solve it; the application cannot infer missing questions.

At the owner's request, [six proposed assignment questions](marketing-assignment-proposals.md) and their [exact owner-executed SQL](sql/marketing-assignment-proposals-2026-09-13.sql) have been prepared. These are new drafts based on the module topic, not recovered or approved questions. They target weeks 4, 8, 12, 13, 15 and 16. The assignments in weeks 13 and 15 carry inherited deletion flags, and week 13 also carries one; the learner reader includes these recoverable rows. This is called out for curriculum review, and the SQL leaves those flags unchanged. A read-only SELECT using the same eligibility predicate matched all six targets. Nothing was published or updated in the database.

The same module's **345 components across 32 authored weeks** were checked with the new read-only scheduling reader: they span October 2026 through June 2027, instead of all inheriting September upload timestamps.

During the initial isolated phase, repository restrictions prevented live writes. That restriction was subsequently overridden explicitly by the owner, and the real transactions/storage tests are recorded at the top of this document. External email/Teams delivery and malware scanning remain uncertified. No migrations, commits or remote Git operations were performed; the bulk account-provisioning and proposed-brief SQL files remain unexecuted.
