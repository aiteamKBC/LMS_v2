# Module sessions per week

Add/Edit module now offers a sessions-per-week selector after a group is chosen, matching weekday buttons, and a shared start/end time. Four weeks with two selected days produces eight session dates. The same schedule feeds the preview, tutor availability check, saved module and existing Teams recurring-calendar flow.

Saved days and times return through catalogue reads and both edit entry points. Module schedule changes preserve the group's own defaults; additional selected groups keep their respective timetables. Weeks remain separate from calendar sessions.

Validation:

- Module form, weekly schedule and week session date suites: 46 passed. After adding the final Teams payload regression, all 7 weekly schedule tests passed (47 distinct focused frontend tests in total).
- SQLite backend regression: 18 passed; one existing fixture failure, `test_a_smaller_weeks_count_never_deletes_authored_weeks`, also reproduced against the original HEAD backend. Its initial assertion expects 12 authored week rows but the fixture creates zero.
- Broader catalogue UI suite: 4 passed / 9 failed, with the same 9 failures reproduced using original HEAD source. Existing expectations involve image controls, navigation and creation feedback.
- Production Vite build passed. `git diff --check` passed.
- TypeScript diagnostics for all 7 changed TypeScript files, using the full project configuration and declarations: zero. The full-app check also found errors outside the changed files (route access, users, holiday tests, module workspace and learner review tests), so the overall application type check is not green. Five typing errors in the new test's query options were corrected before the final focused check and test rerun.
- Browser visual verification was unavailable: the configured browser runtime reported no connected browsers.

Backend tests used `config.settings_sqlite_test`, which only allows SQLite. No production records, Teams meetings or invitations were created for verification. No commits or remote Git operations were performed.

Evidence: `module-schedule-focused.txt`, `module-weekly-tests.txt`, `module-backend-regression.txt`, `module-backend-baseline.txt`, `module-catalogue-baseline.txt`, `module-schedule-frontend-final.txt`, `module-schedule-build.txt`, `module-schedule-changed-types.txt`, `module-schedule-app-types.txt`.
