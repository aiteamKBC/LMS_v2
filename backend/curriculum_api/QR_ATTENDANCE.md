# Curriculum QR Attendance implementation

Local implementation, reviewed 7 November 2026. No production migration,
production data write, commit, push, or deployment was performed. PostgreSQL
migration/integration verification remains pending; this is not an end-to-end
production acceptance result.

## Behaviour

`/qr-attendance` is a public mobile page with one permanent college QR, an email
field, optional current-lecture suggestions, module and lecture selectors, and
confirmation. It uses existing KBC branding. No reference screenshot was present
in the attachment. The page also provides QR SVG download and link copying.

Programme eligibility permits assigned and unassigned modules and other
groups/cohorts within the verified programme. Following the 8 November 2026
requirement, confirmation is allowed only on the occurrence's scheduled start
date in the configured college timezone (Europe/London by default), from local
midnight inclusive until the next local midnight exclusive. Before/after the
lecture's hours and completed lectures remain allowed on that same date.
Past and future dates stay visible with disabled radio controls and an
explanation. Cancelled, deleted, failed, invalid, superseded, and structurally
invalid occurrences remain excluded. Overnight lectures use their start date.

The server rechecks the date inside confirmation before inserting evidence;
client-supplied dates or timezone cannot override it. Suggestions exclude other
dates. The public configuration includes serverNow, which anchors the page clock
independently of the device's calendar clock. The page refreshes eligibility
while open and rechecks on submit. Existing evidence and duplicate constraints
are unchanged. Historical validation notes below describe the earlier policy;
past/future confirmation is no longer permitted.

QR records are declarations only: no Teams sync, manual attendance edits,
feedback changes, hours, progress, completions, or learning-plan updates.

### Same-day attendance validation (8 November 2026)

- PASS: `.\backend\.venv\Scripts\python.exe -B backend/scripts/validate_feedback_attendance_commit.py curriculum_api.tests_qr_attendance`
  — 63 tests, isolated synthetic SQLite and mocked integrations; external
  connections blocked by the runner. Covers server rejection of other dates,
  confirmation after midnight, completed/same-day lectures, programme scope,
  retry uniqueness, and London's 23/25-hour daylight-saving transition days.
- PASS: `npm --prefix frontend run test -- src/pages/qr-attendance src/api/qrAttendance.test.ts --maxWorkers=2`
  — 50 tests in 3 files. Includes disabled past/future cards, same-day early/late
  confirmation, server time despite an incorrect device clock, midnight changes
  while open, inactive-tab refresh, stale suggestions and direct submit rechecks.
- PASS: `npm --prefix frontend run type-check`.
- PASS: `npm --prefix frontend run lint`. Final changed frontend files also
  passed `node node_modules/eslint/bin/eslint.js src/api/qrAttendance.ts src/pages/qr-attendance --max-warnings 0`
  from `frontend`.
- Teams baseline/expanded checks: NOT REQUIRED; no Teams trigger or shared Teams
  dependency was changed. Live Teams and real-database/browser validation: NOT RUN.
- No migration, application-data change, Git publishing or deployment performed.
  Backend/frontend should be released together because configuration now supplies
  serverNow. Existing independent styling/image changes were preserved.

## Verified database relationships

Before editing, read-only Neon schema/constraint queries established that the
configured local database points to the LMS **production** branch. It was never
used for writes or tests. The new table did not exist. All seven new read-query
shapes were also checked against that schema with zero-row SELECTs; this checks
column names/types and joins, not real student journeys or performance.

| Table/key | Verified type and role |
| --- | --- |
| `enrolment."Created_users".id` | Integer primary key; registered `Email`, legacy `Programme`/`Group`, JSON plans |
| `"Learner".learners.enrolment_id` | Bigint enrolment link; programme/group/cohort ID placement |
| `curriculum.programmes.programme_id` | Varchar(150) primary key |
| `curriculum.modules.module_catalogue_id` | Varchar(128) primary key; explicit programme, group and cohort links |
| `curriculum.groups.group_id` | Varchar(128) primary key; programme/cohort ancestry and preset `module_ids` |
| `curriculum.cohorts.cohort_id` | Varchar(128) primary key; programme ancestry |
| `curriculum.live_sessions.id` | Varchar(128) primary key; module foreign key |
| `curriculum.live_session_occurrences.id` | Varchar(128) primary key; series foreign key and unique series/session-number pair |
| `curriculum.module_teams_shares` | Explicit target-module to source-module relationship; checked against `teams_shared_source_module_id` |

Occurrence start/end columns are timestamps without timezone; the existing LMS
interpretation is UTC. Responses include explicit UTC offsets; the UI formats
them using the server's configured business timezone, including UK DST.

Identity resolves exactly one trimmed, case-insensitive registered email. A
unique valid learner-profile programme ID is authoritative. Legacy enrolments
without one can resolve an exact unique programme ID/name from the programme
catalogue. Conflicting or unverifiable programmes fail clearly; module titles
never establish equivalence.

Module eligibility checks explicit programme and verified group/cohort ancestry.
Conflicting ancestry does not grant access. Shared-session traversal follows
explicit directed source links, checks cycles/conflicts, and preserves the actual
occurrence ID and selected delivery module. A source module in another programme
does not appear as an independently eligible module merely because it hosts the
meeting. Duplicate occurrence options are removed.

Assigned group/cohort snapshots prefer verified profile IDs. When IDs are absent,
exact unique legacy names can resolve them within the verified programme and
cohort. Conflicting or stale nonempty IDs are not replaced with guessed names.
Unresolved placement stays NULL and is not an eligibility restriction.
For shared meetings, attended group/cohort describes
the selected curriculum delivery, not a reassignment to the host module's
programme/group. The actual occurrence remains linked to its hosting series.

Suggestions reuse `_effective_plan_ids()` and its safe group-preset parser;
assignment only controls suggestions, never manual eligibility. Explicit and
intentionally empty plans are preserved. See the automatic-selection follow-up
below for current module and lecture priorities.

## Storage and API

`QRAttendance` is an unmanaged Django model, matching this project's external
curriculum-table convention. Migration `0079_qr_attendance` creates
`curriculum.qr_attendance` with a bigint identity primary key, enrolment,
programme, selected module, actual occurrence, nullable assigned/attended group
and cohort IDs, source `qr`, and server-generated confirmation/creation times.
Foreign keys use the verified parent keys and `ON DELETE RESTRICT`: evidence
prevents hard deletion of referenced rows. Existing soft deletion is unaffected.

`UNIQUE(enrolment_id, occurrence_id)` is the duplicate boundary, including shared
aliases. Confirmation re-resolves eligibility inside a transaction and performs
`INSERT ... ON CONFLICT DO NOTHING RETURNING confirmed_at`. A retry reads the
original timestamp without updating any row. Success is 201 for a new record or
200 with `alreadyRecorded: true` for a repeat. Storage failures return 503, never
fabricated success. The migration is deliberately irreversible to avoid erasing
evidence during a code rollback.

The exact public endpoint is `/curriculum_api/qr-attendance/`:

- GET: configured public QR URL, business timezone, CSRF token.
- POST `action: lookup`: email -> eligible modules and current suggestions.
- POST `action: lectures`: email/module -> real occurrences.
- POST `action: confirm`: email/module/occurrence -> idempotent confirmation.

POSTs require CSRF and server validation. Programme/group/cohort supplied by a
client are never trusted. Email stays in the request body. Responses are
non-cacheable and expose no student profile or Teams join links. Only this exact
API is exempted from session gating; neighbouring APIs remain protected.

Throttling uses hashed cache keys, 30 requests/email/minute and a generous 3,000
requests/IP per five minutes for shared college networks. It uses the existing
`TRUST_PROXY_IP_HEADER` policy. Shared limits across workers require healthy
shared Redis; the project's existing local-cache fallback makes throttles
per-process during a Redis outage. This remains an operational limitation.

## Files

| Area | Files |
| --- | --- |
| New backend | `backend/curriculum_api/qr_attendance.py`, `qr_attendance_store.py`, `qr_attendance_urls.py`, `tests_qr_attendance.py` |
| Model/migration | `backend/curriculum_api/models.py`, `backend/curriculum_api/migrations/0079_qr_attendance.py` |
| API routing/security | `backend/config/urls.py`, `backend/login/api_gate.py` |
| New frontend | `frontend/src/api/qrAttendance.ts`, `qrAttendance.test.ts`; `frontend/src/pages/qr-attendance/page.tsx`, `dates.ts`, `page.test.tsx`, `app-flow.test.tsx` |
| Public-page integration | `frontend/src/router/config.tsx`, `frontend/src/lib/activityTrail.ts`, `frontend/src/lib/sessionExpiry.ts` |
| Handoff | `backend/curriculum_api/QR_ATTENDANCE.md` |

The working tree was clean before this task; all existing code outside the
listed changes was preserved. Work stayed in the original folder and branch.

## Verification

From the repository root:

```powershell
# Test-host override is limited to this test process; no .env file is edited.
$env:DJANGO_ALLOWED_HOSTS = 'testserver,localhost,127.0.0.1'
.\backend\.venv\Scripts\python.exe -B backend/scripts/validate_feedback_attendance_commit.py curriculum_api.tests_qr_attendance login.tests_api_gate

npm --prefix frontend run test -- src/pages/qr-attendance src/api/qrAttendance.test.ts src/lib/__tests__/activityTrail.test.ts src/lib/__tests__/sessionExpiry.test.ts --maxWorkers=2
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

- Backend: **70 passed** (35 new QR tests + 35 existing API-gate tests).
  The existing isolated runner permits only in-memory SQLite Django connections
  and blocks external network/mail. Additional SQLite tests execute the actual
  insert/conflict writer against synthetic temporary data, including concurrent
  duplicates, first-timestamp preservation, uniqueness and rollback. They do
  **not** validate PostgreSQL foreign keys, its concurrency semantics, or the DDL.
- Frontend: **44 passed in five files**, covering the public app route,
  suggestions, manual future/unassigned selection, stale-response handling,
  empty/error/loading states, duplicate clicks and UK DST dates, plus existing
  activity/session-expiry consumers.
- TypeScript, full frontend lint, production build, and whitespace checks passed.
  Build emitted warnings concerning Vite/PostCSS and unrelated existing eval;
  build exit code was zero.
- Browser: built static preview with every API response intercepted and every
  external origin blocked; manual future lecture selection and confirmation
  passed. Checked 320/390/768px for horizontal overflow, inspected a synthetic
  mobile screenshot, checked QR rendering, one confirmation request, no page
  exceptions and no activity-audit request. This was not a live backend test.
- Initial test-only failures (cursor patch teardown, environment-dependent proxy
  trust, and the standalone runner's missing test host) were corrected or given
  explicit test context. The final runs above pass; no failing assertion was
  removed or skipped.
- Teams baseline and expanded checks: **NOT REQUIRED**. No listed Teams file or
  consumed Teams contract changed. Live Teams: **NOT RUN**.
- PostgreSQL migration/integration: **BLOCKED / NOT RUN**. The configured database
  is production; no verified writable isolated PostgreSQL target was available.

## Remaining release steps

1. On a verified isolated PostgreSQL environment, review the migration plan and
   apply 0079 with its prerequisites. Test real foreign keys, concurrent retries,
   rollback and HTTP persistence with synthetic curriculum records.
2. Before any production migration, obtain the explicitly requested permission,
   verify the target and backup/restore point, review pending prerequisite
   migrations and the hard-delete RESTRICT impact. No runtime schema provisioning
   is performed by this feature.
3. Verify `FRONTEND_URL` points to the public HTTPS application origin and the
   existing business timezone, CSRF/proxy and shared-cache configuration are
   correct. Production QR generation rejects missing/invalid/loopback URLs.
4. Follow the owner's manual review/Git/deployment process. Apply the reviewed
   migration before exposing confirmation. Until it is applied, saving returns a
   clear unavailable response. A rollback should retain the evidence table and
   remove/roll back application exposure, not delete attendance records.
5. Verify the public URL and email-only student flow against the deployed backend,
   then download/print the permanent QR from the page.

Implementation is available for code review. Production readiness and successful
PostgreSQL migration are not claimed.

## Automatic-selection follow-up (7 November 2026)

Scope: functional QR selection only. The reference UI, persistence writer,
migration, Teams evidence and learner plans are unchanged.

Confirmed code defects:

- Lookup originally returned running occurrences only. A module within its
  teaching window could never be selected when none of its lectures was running.
- The client tied module selection to exactly one lecture suggestion. Multiple
  equally valid lectures in one module left even the module unselected.
- No scheduled-today fallback existed. The client instead selected a sole
  occurrence even when it was on an unrelated past/future date.
- Missing profile placement IDs never resolved through the existing legacy
  enrolment names. Group/cohort OR filtering could also resurrect suggestions
  excluded by an explicit or deliberately empty plan.

The API now returns additive `selection: {moduleId, occurrenceId}` and
`moduleCandidates` fields. The lectures response adds `suggestedOccurrenceId`.
An explicit null is authoritative; the frontend never chooses an arbitrary
past/future row. It retains compatibility with old running-only suggestions
while the two application parts are being updated.

Automatic candidates come only from effective assignments in the verified
programme. Lecture priority is: running in the normal placement; running in
another assigned delivery; scheduled today in the normal placement. Business
dates use the configured timezone and server time. Completed lectures stay
manually selectable but are not newly suggested as scheduled lectures.

If no lecture has a priority, use the assigned module's curriculum start/end
window, extending the end to actual valid occurrences when teaching has shifted.
Prefer the normal placement among current windows. One module is selected even
when no lecture is due. Multiple equally ranked modules stay unselected;
multiple lectures in one module select the module only. Shared aliases preserve
the actual occurrence, do not choose an owner alphabetically, and do not repeat
one occurrence as multiple suggestion cards. Manual delivery choice remains.

Read-only evidence:

- Reverified local default endpoint against Neon project LMS, production branch;
  database `neondb`, required tables present and SELECT permissions available.
  Inspected actual column types, including module dates and legacy cohort names.
- At the audit time there were no valid running or today's native occurrences.
  There were 224 active modules, 49 with their own series/occurrences, 48 with
  valid native occurrences, and 5 shared-source links. Some empty lecture lists
  therefore reflect missing `modules -> live_sessions -> live_session_occurrences`
  data, not a missing frontend request. Shared links are resolved separately.
- 34 enrolments had a legacy group name without a profile group ID; 29 had an
  exact unique programme/group name match even before cohort disambiguation.
- Anonymous reads through `localhost:3000/curriculum_api/qr-attendance/` sampled
  ten actual enrolments. Five valid identities/programmes returned 55, 44, 47,
  5 and 3 modules respectively. Native lecture samples returned 4, 14 and 11
  real occurrences. Sample modules without native source records returned zero.
- One sampled stored email was invalid. Four sampled enrolments had no profile
  programme ID and zero exact matches for their legacy programme name in live
  `curriculum.programmes`. These are unresolved source-data relationships;
  no records were modified and no fuzzy programme mapping was introduced.
- Two actual enrolments selected a unique current module. Independent read-only
  SQL verified the selected IDs against effective assignment and current
  curriculum windows. No lecture was invented for either. No names or email
  addresses were included in this report or screenshots.
- Live calls were configuration, lookup and lecture-list reads only. No live
  confirmation, schema migration or database write was performed. Current/today
  lecture auto-selection was verified with isolated fixtures because no suitable
  real occurrence existed that day.

Follow-up files: `qr_attendance.py`, `qr_attendance_store.py`,
`tests_qr_attendance.py`, this report, `frontend/src/api/qrAttendance.ts`,
`frontend/src/pages/qr-attendance/page.tsx` and `page.test.tsx`.

Follow-up checks:

```powershell
$env:DJANGO_ALLOWED_HOSTS = 'testserver,localhost,127.0.0.1'
.\backend\.venv\Scripts\python.exe -B backend/scripts/validate_feedback_attendance_commit.py curriculum_api.tests_qr_attendance
npm --prefix frontend run test -- src/pages/qr-attendance src/api/qrAttendance.test.ts --maxWorkers=2
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

The focused suites passed: 50 backend tests and 30 frontend tests. Final
TypeScript, full frontend lint, build and whitespace checks also passed. Backend
coverage includes legacy placement, effective plans, current windows, today's
fallback, UK midnight/DST, ambiguous modules/occurrences, shared sources,
unrestricted manual confirmation and the existing duplicate writer tests.
Frontend coverage includes authoritative selections, ambiguous/null choices,
today's non-running suggestion and stale automatic responses after manual changes.
The built UI also passed an isolated browser flow with mocked APIs for automatic
today selection, module overrides, past/future selection and duplicate success.
Teams baseline/expanded checks are not required; no Teams file or consumed
contract changed. The original PostgreSQL persistence-verification limitation
above remains: these read-only checks do not prove live confirmation writes.
