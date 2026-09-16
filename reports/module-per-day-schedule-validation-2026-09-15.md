Module weekday times and Teams series — 15 September 2026

Implemented behavior

- A module selects 1–7 sessions per week, with a start and end time for each selected weekday. The authored week count stays separate from the session count.
- Module previews, saved structure, session dates, tutor conflicts and calendar updates use these individual clocks. Other groups keep their own timetable.
- The Teams create form offers automatic grouping, a separate series/link per weekday, and a shared series when clocks and durations match. Automatic grouping splits different clocks or durations into weekday series.
- One LMS calendar tracks the Graph series. Each occurrence retains its own event, join URL and online meeting ID; attendance and artifacts are grouped by the correct meeting.
- Calendar updates retain each weekday's link. A partial Graph failure saves successful masters, allowing an update to resume without duplicate creation. Unverified sessions are reported, and are never assigned another day's link.
- Module Builder and Week Builder receive the selected session's own link and duration. Subsequent authoring saves restore canonical tracked links.
- SQLite module/occurrence updates preserve row identity, matching PostgreSQL behavior instead of cascading away calendars or attendance via REPLACE.

Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Weekly schedule, tutor conflicts, recurrence | 72 passed | module-per-day-backend.txt |
| Module form, date planning, weekly times, Teams modal/page | 75 passed | module-per-day-frontend.txt |
| Changed production TypeScript files | 10 files, 0 diagnostics | module-per-day-types.txt |
| Production Vite build | Passed | module-per-day-build.txt |
| Wider Teams backend tests | 29 passed, 2 existing failures | module-per-day-teams-backend.txt |
| Same two tests with HEAD views loaded | Same failures reproduced | module-per-day-teams-baseline.txt |
| Workspace schedule tests | 5 passed, 1 existing failure, also reproduced at HEAD | module-per-day-teams-ui.txt; module-per-day-workspace-baseline.txt |

Existing backend failures concern the unavailable enrolment test database alias and an older holiday-date expectation. The workspace failure expects a status label that the current HEAD does not render. These are separate from the new schedule tests. The broader app TypeScript baseline also has existing errors, recorded in module-schedule-app-types.txt by the preceding validation.

Live connection and deployment

- Microsoft Graph client-credentials authentication succeeded; no token was printed or stored. Evidence: module-per-day-graph-auth.txt.
- A live end-to-end calendar write was not performed. No real meetings or invitations were created during verification.
- The configured PostgreSQL host failed DNS resolution. Column availability therefore remains unverified, and migration 0063 was not applied to that database. The local HTTP configuration endpoint also required an authenticated application session.
- No default organizer is configured in this environment; the existing form permits selecting the organizer mailbox. Authentication success alone does not establish that mailbox's calendar/online-meeting permissions.
- Apply curriculum migration `0063_module_weekly_schedule` against the intended database before using per-day schedules. It adds nullable `modules.weekly_schedule` and `live_sessions.calendar_series` JSON columns. The application refuses the corresponding new saves if these columns are unavailable.
- An in-app browser was unavailable, so interface verification used component tests and the production build.

Microsoft's recurrence model describes weekly days separately from the event's start/end time: [recurrencePattern](https://learn.microsoft.com/en-us/graph/api/resources/recurrencepattern?view=graph-rest-1.0), [recurring events](https://learn.microsoft.com/en-us/graph/outlook-schedule-recurring-events). Separate weekday masters implement the requested independent recurring clocks without changing each week's instance solely to achieve a different weekday time.

This report supersedes the earlier shared-time design in module-weekly-schedule-validation-2026-09-15.md. No commit, push, pull or PR was created.
