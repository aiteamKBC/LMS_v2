# Learning record monitoring

The dedicated `record-monitor` staff access lands on `/old-otjh/monitor` through
the existing email/password login. This account reads records only. Super Admin
can also open the dashboard; coach assignment restrictions remain in force.

## Cohort and statistics

The cohort is the intersection of `enrolment."Created_users"` and
`"Last_audit".learners`, matched by the stored Aptem ID, with the latter's
`programme_status` equal to `Active` (case/whitespace insensitive).
Enrolment's programme status is displayed separately: `Delivery` does not remove
an active historical learner from this group. Counts are live, not a fixed 368.
Inactive audit records and records absent from enrolment are excluded from
monitor access. Ambiguous links appear as an issue and cannot be opened.

`GET /audit_api/old-otjh/monitor/` accepts `search`, `status`, `coach`, `programme`
and `page`. Search covers name, enrolment email and Aptem ID. An empty coach
filter selects unassigned learners; omitting it selects all coaches. Pages hold
25 learners. All queries are read-only, with six bulk queries rather than one
set per learner. Responses are private/no-store; the visible tab refreshes every
15 seconds and on focus, with a manual refresh button. Filtered table counts
and whole-cohort statistics are labelled separately.

Signature counts use the same transition programme key, audit version,
confirmation and nonempty signature rules as the existing learner summary.
They track transition review signatures, not every historical signature in the
database. Learner and coach counts are separate; one learner may be outstanding
in both. Both signatures plus the latest `finalized` event are needed for a
completed month, matching the existing summary. Readiness never uses an empty
set of months. A reopened month is no longer complete.

Required months are the frozen transition set. Before a review starts, the
source activity months through August 2026 are shown provisionally. Viewing as
a monitor does not start a transition or freeze any months. Additional source
months can be inspected and are labelled separately from required months.
Opening an unstarted or started learner uses the existing monthly report,
content resolver, protected documents, quiz attempts and signature images.
Attendance, activities, assignments and sign-off keep their existing order.

The dashboard's attention count covers identity links, missing report months,
empty required months and pending revisions. Content availability is checked
when opening a month; dashboard figures do not claim every embedded material
has been validated. No preview checks or downloads run for the entire cohort
while loading the directory.

## Access boundary

`enrolment."Staff_users"."Access"='record-monitor'` is the server authority.
The login payload includes only `previous_records.view`, the monitor home and
navigation. The API gate limits this account to transition reads and its own
login/logout/password handlers, including for batch dispatch. The shared audit
URLs always dispatch to the protected transition views for this account, even
without `transition=1`. All transition mutation endpoints and service signing
and start operations reject a monitor. The browser suppresses auto-start,
signature capture, completion and reopening; server checks enforce the same
rules when bypassing the UI. Changing the requested learner ID is still checked
against the enrolled active cohort.

## Account setup and activation

The new access value requires extending the existing `staff_users_access_check`.
The owner explicitly authorized an exception to the repository's default
manual-SQL rule for this activation. On 8 September 2026 the prepared SQL was
executed on the configured Neon enrolment database: the constraint was extended
and the monitoring staff identity/login account was created. Other access
values were retained. No migrations were used.

The current database is already activated. Open `http://localhost:3001/login`
and use the details from the ignored `.cache/record-monitor-login.txt` file.
The SQL template in `backend/sql/2026-09-08_record_monitor.sql` and its private,
generated `.cache/record-monitor-provision.sql` copy remain available for review.
A server using this same Neon database uses the same account once the frontend
and backend changes are deployed.

The generated script contains a Django password hash. The plaintext password
stays in the ignored local credentials file. The setup creates a staff identity
and linked login account, sends no email, leaves learner records unchanged,
and refuses to overwrite another account using the same email. Its existing
five access values are retained when adding the monitoring access.

## Validation on 8 September 2026

- Live read-only query: 368 linked active learners, 3,306 required/provisional
  months, 101,735 activity rows, 11 coaches. The six-query dashboard took 0.91s
  in the final read-only sample. Three individual summaries matched the bulk
  month/completion totals; an unstarted learner's 13-row report opened with no
  transition insert.
- 118 transition/monitoring/role tests and 66 frontend tests passed. Another 28
  generic API-gate tests passed with the transition feature disabled for that
  isolated suite (its legacy role-only fixtures do not model learner identity).
  Dedicated transition and monitoring tests run with the feature enabled.
- Scoped ESLint and Vite build passed. Full TypeScript checking reports the
  four pre-existing errors in `SessionsTree.tsx:693`,
  `teams-meetings/page.tsx:1106`, and `video-watch/page.tsx:594,597`.
- Native Edge checks used an isolated browser context with intercepted API
  responses generated from read-only source queries: login landing, 25-row
  pagination, empty/filter/search states, learner/month drill-down, unstarted
  read-only sign-off, and a 390px mobile layout all passed. No record mutations
  or browser errors occurred. Local screenshots remain in the ignored
  `frontend/.cache/old-otjh-ui/monitor-*.png` files.
- Real unauthenticated requests through port 3001 and directly to port 8001
  both returned 401 for the monitoring endpoint.
- After activation, a real login through port 3001 returned 200 with monitoring
  access, `/old-otjh/monitor` as its home, and only `previous_records.view`.
  The authenticated dashboard returned 368 learners and 3,306 months in 3.33s;
  a scoped month report returned 200. A CSRF-valid start POST was refused with
  403/read_only, and an unrelated learner API was also refused with 403.
  The verification session was logged out afterward. Learner records were not
  modified by activation or the verification requests.
