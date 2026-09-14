# Curriculum review calendars

## Source and lifecycle

- Curriculum templates generate upcoming reviews on both coach and learner calendars. No configured, applicable template means no generated review slots.
- Eligibility combines programme, selected cohort/group IDs, programme status, enabled state, recurrence and the learner's own enrolment start date. Missing or ambiguous placement data does not grant restricted eligibility.
- The learner Monthly Coaching and Progress Review pages filter by the stable `mcm` and `progress_review` type codes. Template names remain editable. Custom review types appear in the calendar with their own filters.
- Live sessions continue to follow the learner's programme/cohort/group module schedule.
- Opening an unbooked review returns a read-only Curriculum form preview. Booking creates the durable instance; booked forms retain their definition snapshot.
- Coach, learner and employer read the same instance definition and answers. The coach saves/completes the form; the learner and employer see the saved answers, with the employer available only when `visibleTo.employer` is enabled.
- Coach, learner and employer signatures all use `curriculum.review_instance_signatures` with roles `advisor`, `participant` and `employer`. The completion state waits for every required role from the instance snapshot.
- Disabling or archiving a template removes unbooked projections, not booked meetings or historical answers. Cancel an existing meeting separately. Cancelling a configured review's meeting restores its scheduling obligation while the template remains applicable.
- Renames, type changes and target-date edits keep the occurrence identity and booking. Multiple templates with the same type/date stay distinct; same-week bookings are allowed when their times do not overlap.
- Legacy booking keys are reused only when the match is unambiguous. Completed imported reviews remain history; future imported schedules no longer replace Curriculum occurrences.
- Cross-programme copies of restricted reviews start disabled with programme scope because the original placement IDs are invalid in the destination. Select the intended destination placement before enabling.
- Calendar reads do not delete Teams events or clear booking times when a meeting link is missing. Sync failures remain visible and retryable. Rescheduling preserves the existing Teams event and attendee list.

## Deployment

Apply `backend/sql/2026-09-14_curriculum_review_applicability.sql` to the target authoring database **before deploying the application changes**. It adds the nullable JSONB applicability column; existing NULL values retain programme-wide eligibility. No production database changes were performed during this work.

In Curriculum > Programme > Reviews > Eligibility, choose Whole programme, Selected cohorts or Selected groups. Existing reviews default to Whole programme, so configure restricted placement explicitly where required.

After deploying, verify with test accounts in two different groups: add a restricted review, rename it, book/reschedule it, then disable it. Only the intended group should receive new slots; both calendars should agree and the saved booking/history should remain. Verify Teams delivery with an authorized test mailbox; local tests mock Microsoft Graph and do not send invitations.

## Verification (2026-09-14)

- Backend focused acceptance: **211 passed** across applicability, learner calendar/forms, scheduling parity, strict anchors, Review Type metadata, coach rescheduling/sync, Curriculum recurrence and type catalogue tests. SQLite test settings only; Django system checks passed.
- Learner review and calendar-helper frontend suites: **78 passed**.
- Isolated Playwright Chromium smoke check passed at **1440x1000** and **390x844**: renamed review titles, all three review classifications, live sessions, custom-type filtering, opening the Curriculum form and no horizontal page overflow. API responses are fixtures, not production data.
- Broader affected frontend run: **113 passed, 14 failed**. All 14 failing test names also fail on a separate clean `HEAD` export. Five are existing calendar-preview/reschedule expectations; nine are existing ReviewForm wizard tests. The two new eligibility UI tests pass.
- Existing `curriculum_api.tests_reviews` and `tests_review_instances` baseline: 10 failures and one fixture error reproduced on clean `HEAD`; this broader suite is not green.
- Frontend production build passed. Repository-wide TypeScript checking still reports errors outside the edited files: admin/users, curriculum/module-workspace, learner/video-watch tests and users directory code/tests.
- `git diff --check` passed. No commits, pushes, pulls or pull requests were created.

Frontend checks from `frontend`:

```powershell
npm.cmd test -- src/pages/learner/reviews src/pages/learner/calendar src/pages/curriculum/programme-detail/reviews/__tests__/reviews.test.tsx --maxWorkers=2
npm.cmd run type-check
npm.cmd run build
```

Optional isolated browser smoke check, with Vite running on port 5173 and Playwright Chromium installed:

```powershell
node scripts/check-review-calendar.mjs
```

The browser check intercepts all API requests and uses fixtures. It is not a live backend or production end-to-end test.
