# Monthly Logs

The learner's Monthly Cycle and Monthly submission navigation cards are replaced
by one Monthly Logs card. Coaches have Monthly Logs in their navigation and an
action on a learner's case file. Existing assignment submission URLs still work.

- Learner: `/learner/monthly-logs` and `/learner/monthly-logs/YYYY-MM`.
- Staff viewing a learner stay in the learner workspace. The bare navigation
  card resolves the learner selected in that workspace; month links preserve
  them explicitly in `/learner/monthly-logs/<kind>/<enrolment-id>/YYYY-MM`.
  Account role does not switch a learner route into the coach workspace.
- Coach: `/coach/monthly-logs`, `/coach/monthly-logs/<enrolment-id>` and
  `/coach/monthly-logs/<enrolment-id>/YYYY-MM`.
- The old monthly-cycle URLs open the new journal. The pre-LMS transition portal
  and its completion rules remain in place.

Historical months through August 2026 are read from the same transition service:
activities, accepted hours, signatures, source content and protected documents.
GET requests do not start or change a transition. The journal reuses the original
report sections, month cards, signature capture, iframe/file previews and PDF
renderer. All-month PDF downloads can include both historical and current months.
Months are stacked in a single column, oldest first, with new completed calendar
months appended below the retained record. Previous/Next follows that order.
The month index groups compact rows by year. Year and awaiting-signature filters
make longer records easier to navigate; the latter checks the signature for the
current learner/coach perspective. Rows preserve activity counts, accepted and
target hours, both signature states and the report link. Completion accents use
muted purple and slate instead of pale green, scoped to Monthly Logs.

Current months are derived on demand from saved direct progress, submitted
subject attempts, reflections/assignments, completed coaching/review meetings
and measured live-session attendance. Imported progress is excluded. A reflection
linked to a progress entry enriches that entry instead of adding its hours again.
Months use the execution/submission date, not the curriculum's planned date.
For linked historical learners, current activity cannot change a pre-cutoff report.
Only calendar months that have ended in the configured system timezone are
published. The first read after month-end gathers that month's recorded activity;
no scheduled copy, empty calendar month or database write is needed. Direct
report/signing requests for the open month are rejected by the backend.
Future bookings and unsubmitted subject attempts do not create journal rows.
The page refreshes every seven seconds and when refocused.

Subject-attempt storage currently records completion/answers but no measured
duration; those rows show zero hours with an explanatory note rather than reusing
the historical audited hours. Native progress uses the existing recorded-time
rules. Native quiz attempts and subject attempts expose the learner's saved
answers through the journal's content preview.

New signatures use the existing `"Audit".monthly_audit_signoffs` table, with
`learner_id = 'lms:<enrolment-id>'`, `audit_version = 'lms-monthly-log-v1'` and a
programme key containing the reviewed row digest. `signature_data` stores a JSON
capture containing the sanitized PNG, reviewed rows/profile, authenticated actor
ID and capture method. Repeated requests cannot overwrite a signed revision.
Source updates preserve saved signatures and completion, as in Previous learning
record, including a signed month whose final source activity is removed. Each
capture retains the rows reviewed at signing. Draft signatures must
still match the current digest, and a saved signature cannot be overwritten by
a repeated request. Historical signatures use their existing storage and signing service.
As in the transition portal, the learner signature completes the month and the
coach can sign separately.

Every endpoint requires a session. Learners are pinned to their own enrolment
ID; coaches are restricted to assigned learners using their live staff grant.
Staff learner previews and admin coach-view selection are read-only. A stored
coach selection is not applied to learner-perspective requests. The server still
checks the actual account's permission to read the selected learner and never
lets a staff preview sign as that learner. Evidence is owner-scoped and must be
approved before it can be downloaded. Signing checks CSRF, derives the signing
role from the session and verifies the reviewed digest under a learner-row lock.

No schema changes, migrations or manual SQL are needed for the existing database.
Development verification does not submit real signatures or change database data.
Database checks use a read-only transaction; unit tests mock database writes.

Verification commands:

```powershell
# From frontend (all browser API requests are mocked):
node scripts/monthly-logs-smoke.mjs
npx vitest run src/features/monthly-logs src/features/old-otjh --maxWorkers=2
```

Backend regression coverage is in `learner_api.tests_monthly_logs` and
`old_otjh.tests`; run with `unittest` after `django.setup()` and
`DJANGO_USE_SQLITE=true`, without Django database setup.

Learner-perspective correction verified on 12 September 2026:
- 116 frontend tests and 107 database-free backend tests passed.
- Feature ESLint and the production build passed.
- Mocked browser checks passed for chronological stacked months, retained
  signatures and inline material, learner signing, admin learner preview,
  assigned-coach signing and the mobile report. API requests were intercepted;
  no live signatures were submitted.
- Full TypeScript checking still reports six pre-existing errors in AccessPanel's
  test, SessionsTree, teams-meetings, CreateEmployerModal and CreateUserModal;
  none are in the monthly-log change.

Month-index presentation verified with 17 focused frontend tests, feature ESLint,
the production build and mocked browser checks at 1600, 1024, 768, 390 and 320px.
The browser check covers a 12-month record across three years, both filters and
the existing report/signature flow, with no horizontal page/workspace overflow.
