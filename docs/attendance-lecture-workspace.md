# Attendance lecture workspace

The learner Attendance page keeps the LMS theme and now provides module selection, lecture totals, attended/absent/covered/upcoming filters, search, lecture details, KSBs, activities, absence reporting, attendance mode and recent activity.

## Sources and counting

- Historical attendance is read from the configured KBC database's `public.kbc_attendance` on every server request. The Aptem ID identifies the learner. The existing connection configuration is unchanged.
- Historical duration and details come from `Last_audit.learner_attendance`. KSBs first come from the audit editor's `structured_manual_activities.learner_journal_row_ksbs`, through the exact `att:<source_key>` journal reference and Aptem ID. Missing mappings fall back to the lecture's linked materials using the saved learner/material source preference. An explicitly cleared journal mapping remains empty.
- Module matching tolerates punctuation, spacing and a leading qualification level, but must resolve to one of the learner's enrolled groups. If no lecture-specific mapping exists, the module's saved material KSBs are displayed with a **Module KSBs** label. This does not link unrelated activities or mark catch-up complete. All mappings are read afresh; none are copied into the database.
- Native KSBs similarly fall back from the exact live component to its linked week, then its assigned module. Module fallbacks are labelled separately from lecture coverage.
- Lectures are grouped into complete, expandable months, newest first. The first month is open initially; every month header shows its lecture count and attended/absent/upcoming summary. Months can be opened individually or all together, and a month is never split across pages. Closed months defer rendering their session rows. Each session has a date tile, title, module, time, attendance/catch-up status and activity/absence actions. Rows adapt to stacked cards on smaller screens. KSBs show the first three codes, with an accessible disclosure for the complete mapping; module fallbacks retain their label.
- Historical activities must belong to the learner's Last_audit group, match the lecture's group/module, and match its date or exact title. Missing or ambiguous mappings remain unmapped. Catch-up completion reads both historical results and current saved subject attempts.
- Native lectures come from the current Teams invite list and non-cancelled `curriculum.live_session_occurrences`. Only synced attendance reports count as attended/absent. Future sessions, sessions in progress and completed sessions awaiting a report have separate states.
- Native KSBs and activities come from the learner's assigned curriculum. A live component must match the exact occurrence, or the meeting and authored date, so completing one occurrence cannot cover an entire recurring series. Its authored week supplies the activity bundle.
- Native `timestamp` columns are interpreted as UTC before conversion to the system business timezone. This matches the existing Django connection's storage convention.
- Late attendance counts as attended. Upcoming and unsynced lectures do not reduce the attendance rate. A covered absence remains an absence in the live register; it is also counted under covered missed lectures. All linked activities must be complete before catch-up is covered.
- Counters follow the selected module. Search, month and status filters affect the visible sessions; sorting and month expansion run locally on the cached response without more API requests. Search includes content, collapsed months and collapsed KSBs, and matching months open automatically for search/status/month filters. Changing filters resets manual expansion choices. The page refreshes every 30 seconds while visible, on return/focus, reconnection, and after mutations. A failed refresh retains the previous result with a warning.
- Recent activity uses source attendance, absence reports, current learner progress/events, support bookings and attendance preference state. No sample activity is displayed in the product.

## Opening attendance in Monthly Logs

`Open Activities` navigates to the same learner's Monthly Logs, opens the recorded
month and expands the attendance row with the exact `source_ref`. Historical
records use `att:<source_key>` and the saved journal month; Teams records use
`attendance:<occurrence_id>` and the stored scheduled timestamp's month. Source
content uses the existing Monthly Logs iframe preview. Missing or ambiguous rows
show a message without selecting another lecture, and existing month availability
and permissions still apply. This navigation does not create or update log rows.

## Absence reports

The existing report API now accepts absent and upcoming lectures from either source. It re-resolves the learner's live register on submission and rejects attended, cancelled, unrelated or ambiguous sessions. Native occurrence report IDs include the learner ID; bigint report IDs travel as strings to avoid browser rounding. Existing KBC report IDs remain compatible. A session can have one report, including one already declined.

A reason is required. Additional information and evidence are optional. The existing coach review record and evidence storage are reused. The confirmation describes a saved report, rather than claiming an email was sent.

## Manual database setup

Run the exact SQL in `backend/sql/2026-09-12_attendance_preferences.sql` in the Neon SQL Editor against the LMS/enrolment database. No migration or schema-changing command is used. The SQL was **not executed** during implementation.

The lecture workspace operates before this SQL is applied; the Attendance Mode controls remain unavailable until its table exists.

## Attendance mode and email

- Live Sessions is the default.
- Requesting Lazy Mode pauses absence reminders while manager approval is pending. Remaining planned lecture hours stay allocated to live sessions until approval.
- The manager is resolved from the linked Employer, falling back to the Extended ILR line-manager email. The learner cannot approve via their own email address.
- The existing Azure mail transport must be configured. `FRONTEND_URL` must point to the deployed application, whose `/learner_api/` paths reach Django. No email was sent during implementation or testing.
- The emailed link previews a request on GET. Approve/Decline requires a CSRF-protected POST and an expiring signed request token. Tokens expire after seven days, are invalidated on decision/cancellation, and stop working if the manager changes.
- Approval switches the remaining dated lecture-hours allocation to recorded sessions. This is calculated from the current schedule on each read, keeping reschedules dynamic. It does not rewrite historical attendance, component types, completion records or signed training-plan documents. Lectures with missing duration are disclosed separately.
- Declining, cancelling or allowing a request to expire resumes live-session reminders. The learner can return to Live Sessions or submit another request after expiry. A failed email delivery is shown and can be retried.

The new reminder command is a preview by default. After manual SQL setup, an owner-managed scheduler can invoke it for the desired learner IDs. It considers only unreported, uncovered absences from the last seven days and sends at most once per learner/lecture. It rechecks the attendance preference under a lock before sending.

```powershell
# Preview only (no writes or email):
.\.venv\Scripts\python.exe manage.py send_attendance_reminders --learner-id 123
# Delivery, when explicitly scheduled by the owner:
.\.venv\Scripts\python.exe manage.py send_attendance_reminders --learner-id 123 --send
```

Neither delivery nor an operating-system scheduler was activated during implementation.

## Verification

### Attendance layout

Nine focused frontend tests cover module/month filters, date ordering, complete
months with more than 12 sessions, individual/all-month toggles, searches inside
collapsed months and KSBs, source refresh, linked activities, support routes and the
existing attendance-mode/absence-report flows. The browser smoke uses 62 fixture
lectures, verifies navigation and disclosures, and checks page/row overflow at
320, 390, 640, 768, 1024, 1280, 1440 and 1920 pixels. All API calls are intercepted;
the layout changes require no database changes. Four Attendance cases from the
learner-page matrix also pass, including load failure/recovery and optional reads.

### Attendance loading follow-up

The lecture endpoint now selects only the learner identity fields it needs.
Historical material reads first resolve the register's modules against the
learner's enrolled groups, including the existing ambiguous-title checks, then
load activities only from those groups. Quiz question bodies and reading URLs
are reduced to presence flags for completion calculations.

Native component reads intersect assigned modules with the modules represented
by Teams lectures. A historical-only register skips the curriculum-component
query while retaining direct progress for Recent Activity. The native query
projects the scheduling fields used by this page instead of downloading every
component's settings and lesson content. Module matching and KSB fallbacks are
reused within each request. The browser loads the material player when an
activity is opened.

Read-only measurements from this development machine, including source lookup
and response serialization but excluding HTTP authorization and browser startup:

| Sample | Before | After | Lectures |
| --- | --- | --- | --- |
| Historical register, learner 125 | 9.57 / 10.02 s | 2.79 / 2.10 s | 62 |
| Teams register, learner 101 | Not measured | 1.80 / 1.02 s | 65 |

The historical response retained its 134,954 serialized bytes and matched a
baseline payload fingerprint after canonicalizing list order. The measurements
are individual observations, not guaranteed production timings. The shared
Teams attendance reader and live KBC connection behavior remain unchanged.
The profile runner disables unrelated curriculum warm-up and sets every
PostgreSQL connection to read-only; it prints only timings, counts and hashes.
Re-run with `backend/.venv/Scripts/python.exe backend/scripts/profile_attendance_loading.py 125`.
No schema or data change is required for this improvement.

Verification for this follow-up: 45 database-free backend tests, 110 frontend
tests (Attendance, shared reads and the learner-page matrix), the production
build, and the existing desktop/mobile Attendance browser smoke all passed.
The broad frontend suite initially hit `ENOSPC` on C: and passed after redirecting
its temporary files to E:; no unrelated files were removed.

### Original verification

- 41 focused backend tests passed using `unittest` and `SimpleTestCase`, with no database setup, migrations or database mutations. These include KSB fallback scope, source edits, cleared mappings and ambiguous module names.
- 10 frontend attendance/page tests passed, covering source refresh, module filtering, activity opening, support destinations, manager request state and optional absence details.
- A Playwright smoke test rendered the real app with intercepted fixture APIs, checked desktop and mobile layout, opened the absence form with the selected lecture, filtered modules and opened activities. No browser errors or mobile page overflow were observed. Re-run with Vite on port 5184 and `node scripts/attendance-smoke.mjs` (Chrome by default).
- Read-only source samples: the historical sample returned 62 lectures, 59 attended, 3 absent, 95% attendance and 1 covered absence. All 62 rows now display sourced KSBs: 30 exact attendance mappings, 28 linked-material mappings and 4 labelled module fallbacks. A native-only sample returned 65 occurrences, 2 attended and 22 upcoming; unsynced occurrences remained pending.
- Full TypeScript checking still reports pre-existing errors in `AccessPanel.test.tsx`, `SessionsTree.tsx`, curriculum `teams-meetings/page.tsx`, `CreateEmployerModal.tsx` and `CreateUserModal.tsx`; no Attendance file errors were reported.
- The broader pre-existing API gate suite is not green under the direct offline runner: its legacy learner mock lacks `is_active`, and its client smoke expects `testserver` in `ALLOWED_HOSTS`. The new exact-path gate and signed approval checks pass independently.
