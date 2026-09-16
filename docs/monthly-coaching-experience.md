# Learner monthly coaching experience

The landing page answers two questions: what is my next meeting, and is there anything I need to do? The complete programme schedule sits behind **View all meetings**.

## Screen plan

1. **My coaching:** concise heading and a visible link to all meetings.
2. **Needs your attention:** unresolved actions, including the learner's required signature, remain visible separately from the next appointment. Show at most two reminders, with a link to the complete action list.
3. **Current meeting:** date, time, timezone, meeting coach and one primary action. Secondary options contain rescheduling, absence reporting and calendar navigation.
4. **Preparation:** three short prompts about progress, challenges and next steps. A previous summary is available when there is one.
5. **All coaching meetings:** Needs your action, Upcoming and Past tabs, eight records per page. Preserve learner identity, tab and page when opening a record and returning.

## Action rules

| Verified meeting state | Primary action |
| --- | --- |
| Booked today with a valid meeting link | Join meeting |
| Future booking, or today's link not ready | Prepare for meeting |
| Planned but not booked | Book a time |
| Absence reported or missed, still reschedulable | Reschedule meeting |
| Submitted template requires the learner's unsigned signature | Review & sign |
| Attended, completed or awaiting someone else's signature | View summary / meeting |

Future planned meetings enter the action list seven days before their target date. Booking stays available before then. Attendance is confirmed through its own explicit control; opening a meeting link does not confirm attendance. Backend attendance flags determine absence and eligible actions. Dates alone do not prove absence. Imported reviews remain read-only.

The current coach comes from the learner's latest assignment. An existing meeting keeps its original host; if different, the card explains who that meeting is booked with. Changing the assignment does not transfer the Microsoft meeting. A valid meeting link stays visible for future bookings and reported absences alongside the main action. Cancelled or closed bookings do not offer a joining link, and a missing URL is explained explicitly.

Template definitions determine whose signature is outstanding. If that information cannot be fetched, show a neutral signature-pending state and allow the learner to open the summary. Do not announce that their signature is required without evidence. After signing, refresh the definition as well as calendar data.

The monthly learning log remains available as an inline link on the detail page, without automatically covering the review with a modal.

## Review signatures

1. The coach saves the meeting answers and completes every required question before submitting the review.
2. Submission keeps the coach's form open and moves focus to the signature step. The submitted answers are read-only. Required parties can then sign in either order; submission alone is not a coach signature.
3. Both views show the original saved signature image, signer's name and signing time in Europe/London, with a separate pending state for each required party. Missing historical images are reported honestly; no replacement mark is generated from a name.
4. The learner sees the next action above the review sections and can jump directly to the signature step. A learner who has already signed sees their saved signature and who is still pending, without being asked to sign again.
5. A save failure leaves the signing step available for retry. The interface blocks duplicate requests while saving. After a successful signature, the review definition and calendar status are updated; the last required signature makes both the review instance and calendar record Completed.

The Monthly Learning Log is a separate record with its own signing rules. Signing this review does not sign the monthly log.

## Validation

- Focused state, component and integration tests cover signature ownership, schedule states, permissions, attendance, absence and navigation.
- `node scripts/check-coaching-ux.mjs` in `frontend` checks desktop and mobile against a running local Vite server (default port 3000). It uses isolated fixtures, blocks API calls and saves screenshots under `frontend/screenshots/coaching-ux`.
- The visual check covers keyboard tabs, heading focus, booking callbacks, current/history navigation and horizontal overflow. No real booking or attendance record is changed.
- `node scripts/check-review-signatures.mjs` checks the saved learner signature, pending coach, name/date, jump-to-signatures focus and mobile layout using synthetic evidence only. It blocks API calls and writes screenshots under `frontend/screenshots/review-signatures`.

Progress Reviews use the same signature display and refresh after signing; their layout, dashboard progress calculations and historical coach attribution are outside this redesign.
