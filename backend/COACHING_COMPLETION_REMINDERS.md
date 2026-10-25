# Aptem MCM / PR completion reminders

## Agreed policy

The coach completes the review in **Aptem**. Create an LMS inbox reminder at
24 elapsed hours after the verified occurrence ends; create the final reminder
at 72 elapsed hours after that same end instant. Discovery after 72 hours creates
only the final stage. Each coach receives at most one email digest per business
day, starting at 09:00 in the configured LMS `TIME_ZONE` (normally Europe/London).
Reading/dismissing a reminder does not complete a session or stop the email stage.
There is no manager escalation or automatic completion, hours/credit change,
AI generation, PDF generation, Graph calendar scan, or video access in this job.

## Source contract and current blocker

Read-only source: Kent / New era / `public.aptem_session_components`,
`public.all_sessions_cache`, `public.meetings`, using the existing
`COACHING_SESSIONS_DATABASE_URL`. No source writes or schema changes.

A source link must exist **before** completion:

* `all_sessions_cache.component_id -> aptem_session_components.id`;
* `all_sessions_cache.meeting_id -> meetings.id`, exactly one association;
* matching coach emails, learner IDs, occurrence start/end, confirmed learner
  attendance and a non-cancelled meeting;
* source component `status` refreshed within 24 hours, and current LMS coach
  grant/caseload resolved from server-owned learner email, not coincident IDs.

`Completed` suppresses reminders. `Awaiting Signature` has a separate display
and does not accuse the coach of failing to complete. Only `Scheduled` and
`In Progress` are coach-action candidates after all other checks pass.
`completed_date` is **not** sufficient: existing Scheduled/In Progress source
rows also contain this field. Unknown/stale/missing/ambiguous associations are
withheld; a missing AI report never proves missing completion.

Read-only inspection on 24 October 2026 found that recent Scheduled/In Progress
source components have no meeting link, actual start/end, or coach email on their
cache rows. The source maintainer must publish those explicit links for held,
incomplete sessions as well as completed sessions. This implementation does not
invent associations from a title, name or planned date. `unlinked` in the command
output is an aggregate source diagnostic, **not a count of overdue coach actions**.

Until the source supplies these associations, a preview can legitimately show
zero actionable reminders. Do not enable email expecting it to repair source
matching. There is also no verified Aptem per-session URL in the source contract;
notifications link to the authorized LMS occurrence and instruct the coach to
complete it in Aptem, rather than inventing an Aptem deep link.

## Local storage and endpoints

Migration `coach_api.0030_coaching_completion_reminders` adds three Coach tables:
`coaching_completion_session`, `coaching_completion_reminder`,
`coaching_completion_digest`. Source report/attendance/history are unchanged.
Unique session/stage and coach/day constraints make scheduler retries idempotent.
Delivery claim commits before provider IO; accepted email is not proof of mailbox
delivery. Timeout/crash remains `uncertain`, with no automatic resend of that
stage. Review provider logs before any operator recovery; never clear a claim
blindly. A source failure aborts dispatch instead of sending from stale data.

`GET /coach_api/coach/completion-notifications` reads up to 100 personal reminders
from local storage. Fresh authenticated staff grant and current caseload are
checked; no view-as access. `POST` uses CSRF and `{ids:[1],action:"read"|"dismiss"}`;
foreign IDs are never updated. The `/notifications` screen adds a separate coach
completion inbox, leaving existing role/absence notices unchanged. Client reads
coalesce with a 30-second, account-scoped memory cache and no polling. Evidence
responses include optional completion status via one small local query when the
user opens the evidence section; no additional source/browser request.

## Release and activation

No production migration, live email or service activation is performed by tests.
Use the repository's reviewed-main release procedure. Verify the actual primary
LMS database, restore point, migration plan and source target before migration.
Retain existing migration dependencies (0027–0029). Do not run a broad migrate
against an unverified database just to apply this feature.

1. Apply the reviewed migration on the verified primary LMS target.
2. Choose an explicit rollout date to avoid mailing a historical backlog.
3. Run a read-only preview from `backend`:

   ```text
   python manage.py process_coaching_completion_reminders --since YYYY-MM-DD
   ```

4. Review source diagnostics and verify incomplete sessions have valid links.
   Write inbox reminders without sending email:

   ```text
   python manage.py process_coaching_completion_reminders --since YYYY-MM-DD --reconcile
   ```

5. Configure the existing email sender and the actual public HTTPS LMS origin.
   Schedule the following command once every 15 minutes using the existing
   service account/approved scheduler, **not** an HTTP request or browser timer:

   ```text
   python manage.py process_coaching_completion_reminders --since YYYY-MM-DD --reconcile --send --site-url https://YOUR-LMS-HOST
   ```

The source scan is bounded to the last 31 days and at most 5,000 metadata rows;
recent open components are rechecked by ID, and dispatch rechecks the source in
one batch. The rollout date remains valid as time advances. Command output
contains aggregate counts only. Stop scheduling to pause delivery; keep the
tables and delivery history for audit/rollback. Do not drop/reset stored claims.

Reconciliation uses bulk upserts/inserts, not SQL queries per meeting. Unchanged
session metadata is not rewritten for 30 minutes; source verification still runs
before dispatch. Source `withheld` counts invalid associations; `unlinked` counts
unassociated planned components and is not an attendance/overdue determination.

## Validation — 24 October 2026

From the repository root, verified SQLite aliases, LocMemCache, disabled
automation and mocked outbound services:

```powershell
.\backend\.venv\Scripts\python.exe .qa-tmp/coaching_index_tests.py coach_api.test_completion_reminders coach_api.test_recordings_links coach_api.test_quality_reviews coach_api.test_recordings_api coach_api.test_recordings_saved_evidence coach_api.test_recordings_pdf coach_api.test_recordings_evidence_api coach_api.test_recordings_response_cache coach_api.test_recordings_index coach_api.test_recordings_jobs
```

PASS: 243 tests, including 21 new completion tests. Coverage includes the exact
24/72-hour boundaries, current ownership/revocation, cancellation/missing source,
source refresh before dispatch, one digest per coach/day, uncertain transport,
CSRF, persistent read/dismiss and a 100-session query-budget regression.

From `frontend`:

```powershell
npx vitest run src/pages/coaching-recordings src/pages/notifications/CompletionNotifications.test.tsx src/api/coachingCompletion.test.ts src/api/coachingRecordings.test.ts src/api/coachingQualityReviews.test.ts src/api/absenceNotifications.test.ts src/pages/learner/monthly-submission/AssignmentPdfPreview.test.tsx src/lib/__tests__/coachFetch.test.ts --maxWorkers=2 --reporter=dot
```

PASS: 213 tests / 20 files. `npm --prefix frontend run type-check` PASS.
Scoped ESLint PASS (both new API/inbox files and their tests, notifications page,
coaching API/tests, CompletionNotice and SavedMeetingEvidence). Exact lint command
from `frontend`:

```powershell
npx eslint src/api/coachingCompletion.ts src/api/coachingCompletion.test.ts src/api/coachingRecordings.ts src/api/coachingRecordings.test.ts src/pages/notifications/CompletionNotifications.tsx src/pages/notifications/CompletionNotifications.test.tsx src/pages/notifications/page.tsx src/pages/coaching-recordings/CompletionNotice.tsx src/pages/coaching-recordings/SavedMeetingEvidence.tsx --max-warnings 0
```

`npm --prefix frontend run build` PASS (29.33 seconds), with dependency eval,
chunk-size and plugin-time diagnostics; dependencies/build settings were not
changed. `git diff --check` PASS. Offline migration verification
`.qa-tmp/verify_completion_migration.py` matched model fields/indexes/constraints
and compiled 15 PostgreSQL DDL statements without any database connection.

Synthetic browser harness `.qa-tmp/coaching-completion-ui.cjs` inspected the real
inbox/notice components at 1280px and 390px, with every API mocked: no horizontal
overflow, one initial GET under StrictMode, successful read/dismiss, one shared
CSRF initialization and no polling or document/source requests. No real learner
data or live emails were used.

Teams baseline: NOT REQUIRED; expanded Teams checks: NOT REQUIRED. No listed
Teams file or a contract imported by one was changed. Live Teams: NOT RUN.
At the 24 October validation point, the production schema migration and scheduled
email activation were NOT RUN. See the preparation update below; incomplete-session
linking remains a prerequisite for meaningful delivery.

Mandatory feature checks use `.qa-tmp/coaching_index_tests.py` (verified isolated
SQLite/LocMemCache, mocked source/email, no network). Teams checks are not
required: no listed Teams implementation/imported contract is changed.

## Preparation update — 25 October 2026

- Read-only source verification for planned dates 25 September–25 October found
  117 Scheduled and 33 In Progress MCM/PR components with no physical meeting
  association. Their Aptem status rows are fresh, but these counts are not proof
  that 150 meetings were held or that 150 reminders are due. Do not infer links
  from names, titles, planned dates or missing AI.
- Fixed reminder links to the registered `/coach/recordings` route. The Curriculum
  route remains `/curriculum/coaching-recordings`; occurrence ID, date, time zone
  and all-status filter are retained. A regression checks both destinations
  against the frontend's registered routes. The incorrect coach route failed the
  regression before the fix; all 22 reminder tests then passed with isolated
  SQLite and mocked outbound services.
- Prepared the three additive tables from migration
  `0030_coaching_completion_reminders` on the verified primary LMS project
  `green-term-97168878`, branch `br-holy-band-abhispwg`, database `neondb`.
  The target's restore history was verified at 14 days. Direct database access
  from the execution environment was unavailable, so the 15 PostgreSQL statements
  generated by Django's migration schema editor were applied through Neon MCP in
  one transaction, with target/dependency/absent-table guards, an advisory lock
  and bounded statement/lock timeouts. Its Django migration record was added in
  that same transaction. This was migration preparation, not an app deployment.
- Post-write verification found zero sessions, zero reminders, zero digests and
  exactly one migration record. No learner status, source cache, AI, attendance
  history or real inbox item was changed; no email was sent and no scheduler was
  enabled. Keep these additive empty tables when rolling back application code;
  do not remove audit/delivery history if the feature is later used.
- Release still requires reviewed application code, a chosen rollout date,
  verified source links, sender/public-origin configuration and scheduler setup.
  A scheduler cannot repair missing source links.
