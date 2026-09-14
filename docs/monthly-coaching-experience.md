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

Template definitions determine whose signature is outstanding. If that information cannot be fetched, show a neutral signature-pending state and allow the learner to open the summary. Do not announce that their signature is required without evidence. After signing, refresh the definition as well as calendar data.

The monthly learning log remains available as an inline link on the detail page, without automatically covering the review with a modal.

## Validation

- Focused state, component and integration tests cover signature ownership, schedule states, permissions, attendance, absence and navigation.
- `node scripts/check-coaching-ux.mjs` in `frontend` checks desktop and mobile against a running local Vite server (default port 3000). It uses isolated fixtures, blocks API calls and saves screenshots under `frontend/screenshots/coaching-ux`.
- The visual check covers keyboard tabs, heading focus, booking callbacks, current/history navigation and horizontal overflow. No real booking or attendance record is changed.

Progress Reviews, dashboard progress calculations and historical coach attribution are outside this redesign.
