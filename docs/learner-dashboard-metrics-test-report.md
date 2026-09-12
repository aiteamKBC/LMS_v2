# Learner dashboard metrics verification

Verified on 12 September 2026. These checks cover the shared Programme Progress, OTJ Hours and KSB totals, and the combined attendance register. Source definitions and the owner's confirmed calculation rules are in [learner-dashboard-data-rules.docx](learner-dashboard-data-rules.docx) and its [Markdown copy](learner-dashboard-data-rules.md).

## Automated checks

| Check | Result |
| --- | --- |
| `npm.cmd run test:learner` in `frontend` | 653 tests passed in 66 files after automatic refresh changes |
| Django `learner_api.tests_dashboard_metrics`, `learner_api.tests`, `learner_api.tests_student_activity` | 151 tests passed; no test database created |
| Metrics tests after the final historical KSB baseline correction | 17 tests passed |
| Frontend Vite production build | Passed |
| `git diff --check` | Passed; only existing Windows line-ending notices |
| TypeScript application check | Six existing errors outside the learner changes, listed below |

Backend command:

```powershell
.venv/Scripts/python.exe manage.py test learner_api.tests_dashboard_metrics learner_api.tests learner_api.tests_student_activity --testrunner=django.test.runner.DiscoverRunner --noinput
```

The regression checks cover new versus migrated learners; completed activity unions by explicit identity; repeated KSB codes across different activities; historical and new KSB point unions; missing data; failed quiz attempts; old completion surviving later attempts; saved contract hours; manual time precedence; repeated time records; Teams reconnects; enrolment isolation; refreshed KBC rows; request sharing; cached first renders; learner changes; cancellation; retry; and cache invalidation after saving progress. Page tests use fixtures, not signed-in browser sessions.

## Read-only live verification

Enrolment 125 resolves to Aptem 92. The following values were read from the configured databases; they are not constants in the implementation.

| Metric | Observed value |
| --- | --- |
| Programme Progress | 1,227 / 3,746 activities = 32.75% |
| Historical completed activities | 1,226 |
| KSB Progress | 5,316 / 13,815 mapped point occurrences = 38.48% |
| Historical achieved KSB point occurrences | 5,312 |
| Accepted historical Actual | 1,171.3406 hours |
| New recorded time | 0.0017 hours |
| Combined Actual | 1,171.3423 hours; displayed as 1,171.34 |
| TP Planned | 867.00 hours from the stored imported contract |
| Attendance | 59 / 62 sessions = 95%; this learner currently has KBC rows only |

The shared metrics read took approximately 2.5–2.7 seconds in the final local samples after removing unused question content and KSB descriptions from the query. This measures one learner's server-side read, not every page's end-to-end navigation time. The frontend shares in-flight requests and retains metrics for 30 seconds, with invalidation after progress saves.

## Automatic refresh of old and new sources

The metric and attendance hooks now revalidate every 30 seconds while the page is visible and online, on returning to the tab, and on reconnecting. Successful writes that invalidate learner reads notify mounted cards immediately; issuing a training-plan document and saving in the previous-record portal also invalidate these reads. Changes made elsewhere are picked up on the next visible refresh, rather than through a server push connection.

Background refresh keeps the last successful figures visible. Failures display a retry message and continue periodic retries. An initially empty attendance register can become populated without navigating away. Changes can increase or decrease figures, including corrected historical hours, activity totals, KSB targets, attendance, and contract hours.

The targeted regression run passed 216 tests across 16 files. This includes shared background requests, replacement of a fresh cached snapshot, live corrections, automatic save notifications, rejection of late pre-save responses, hidden-tab polling suspension, focus-event coalescing, unmount cleanup, failure recovery, and the learner page regression suite. The 17 backend formula tests also passed. No database writes were used to exercise these scenarios.

A local headless browser preview using intercepted API fixtures also passed: all four Overview cards changed while the page remained open, without navigation or reload. The changed fixture produced Programme Progress 40%, KSB Progress 40%, Attendance 90%, Actual 1173.34 hours and TP Planned 900.00 hours. These are test values only. The final full learner suite passed 653 tests, the production build passed, and TypeScript reported only the six existing errors below.

No live database records were changed. No migrations were created or run. The live checks did not call the full learner-detail endpoint because its existing hydration path can write data.

## Existing TypeScript failures

- `src/pages/admin/users/AccessPanel.test.tsx:89`: required `isSelf` prop missing.
- `src/pages/curriculum/programme-detail/SessionsTree.tsx:693`: duplicate JSX attribute.
- `src/pages/curriculum/teams-meetings/page.tsx:1130`: duplicate object property.
- `src/pages/users/components/CreateEmployerModal.tsx:336`: undefined `label`.
- `src/pages/users/components/CreateEmployerModal.tsx:337`: undefined `created`.
- `src/pages/users/components/CreateUserModal.tsx:505`: undefined `created`.

The Vite build succeeds independently of these type-check failures. They remain outside this learner metrics change.
