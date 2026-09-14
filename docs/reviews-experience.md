# Learner Reviews experience

The Reviews landing page now shows the current review first, with a clear next action and a separate reminder for other reviews needing attention. **View all reviews** opens readable rows with All, Upcoming and Past filters. Returning from a review preserves the learner, filter and page.

## Scope and data preservation

- This change only edits the learner Reviews presentation and its return navigation. It does not modify backend files, SQL, database records, review templates, recurrence, booking windows, attendance-credit rules or signature submission rules.
- `useReviewSessions`, `useMeetingBooking`, `useMeetingAttendance`, the booking/absence dialogs and the detail page's signature handlers remain the existing implementations. Original event objects and durable identities are passed to the action handlers.
- Current-review ordering reuses `featuredSession`. The presentation uses the matched attendance appointment when available. An outstanding review is a fallback when there is no upcoming appointment; older outstanding work also remains visible separately.
- The existing read-only review-definition loader is reused to identify a required learner signature. Unknown signature ownership gets neutral wording. The details page continues to enforce the original signing rules.
- Imported history remains read-only. Completed, cancelled and submitted reviews do not gain booking/attendance actions from stale attendance flags. Joining a meeting does not confirm attendance.
- Target dates remain distinct from confirmed appointments. Calendar-sync warnings, error/retry states, attendance notices and preview permissions remain available.
- The existing detail form is unchanged except for its Back to Reviews destination, which retains recognised list-view parameters and the resolved learner identity.
- No commits, remote Git operations, database operations or invitations were performed for this change. Pre-existing workspace edits were preserved.

## Readability and navigation

The landing page removes the six statistics cards and the duplicate table. Main text is 16px, key dates and titles are larger, and primary controls are at least 48px tall. Secondary actions expand under More options. The current/all heading receives keyboard focus when the view changes. A short link above the current review exposes any additional attention items on smaller screens.

## Validation

Baseline learner Reviews suite: 70 tests passed before implementation.

Final focused run: **163 tests passed across 13 files**. The frontend production build and targeted ESLint checks passed. The final smoke run passed at all four viewport/zoom settings with no runtime errors or API/write attempts.

Focused coverage checks booking payloads, exact event/learner IDs, CSRF and attendance credit, signature eligibility, read-only history, cancelled/completed records, retry behavior, current/all navigation, retained filters/pages and zero write requests while browsing. Additional component tests use frozen inputs and verify the original objects reach existing callbacks.

Run the focused suite from `frontend`:

```powershell
npm.cmd test -- src/pages/learner/reviews src/pages/learner/progress-reviews src/pages/learner/monthly-coaching src/components/reviews --maxWorkers=2
```

The isolated Playwright smoke check uses synthetic props and intercepts API/external requests. It verifies current/all/back navigation, target versus booked dates, pending signatures, links, attendance callbacks, empty/history states and reflow at 1440px, 390px, 320px and 200% CSS zoom. CSS zoom is not a native browser zoom test. The fixture is not a live-backend or production walkthrough and does not test Microsoft invitation delivery.

With a local Vite server on port 3000:

```powershell
node scripts/check-reviews-ux.mjs
```

The broader learner page run reported 246 passing tests and 14 failures, all in Dashboard/placement/attendance-summary assertions outside this change. The focused review cases passed. Full TypeScript checking also reports errors outside the implementation files changed here (including existing form-access test queries and other workspace areas); a repository-wide green result is not claimed.
