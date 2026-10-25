# Coaching quality reviews: shared record contract

The Curriculum meeting drawer opens the **Portfolio Sampling Feedback Form**.
A review covers one learner's apprenticeship journey and is linked to one coach
calendar occurrence. The meeting is an evidence source, not proof that every
portfolio criterion was met. Users with the existing Curriculum grant (including
the established super-admin hierarchy) can read, save and complete reviews.
Coach-only and learner accounts cannot write reviews.

## Ownership and database

Existing Coaching Session source: Kent organization, **New era** project
`fragrant-mountain-14750513`, branch `br-dry-sun-awo6g12b`, database `neondb`.
Use the existing server-side `COACHING_SESSIONS_DATABASE_URL`; never send the
credential to the browser. Existing AI is read from the source app, including
`public.all_sessions_cache` and `public.report_ai`. This feature never generates
AI or copies video to Azure.

The additive SQL in `coach_api/sql/coaching_quality_v1.sql` installs a separate
`lms_quality` namespace. It was applied to the verified source above on
24 October 2026; the three new tables were verified empty afterward. Existing
meeting, AI, transcript and cache tables were not altered. The source project
reported a 24-hour restore history before the change. No real review or evidence
was inserted during verification.

- `review`: current canonical JSONB snapshot, unique identity, coach, learner,
  UTC occurrence, status and integer version.
- `revision`: immutable full snapshots for each saved version, actor and unique
  request ID/hash. No UI operation deletes earlier versions.
- `image`: immutable, normalized JPEG screenshots belonging to one review and
  section. At most 20 retained images per review, at most 1 MiB each; the current
  form references at most two images in each of five screenshot sections.

Do not put user reviews in `all_sessions_cache`: rebuilding a source cache must
not delete an audit decision. Screenshots stay in the shared review store; no
second file store or Azure dependency is introduced.

An explicit environment installation/check is available through:

```powershell
python manage.py apply_coaching_quality_schema --expected-project fragrant-mountain-14750513 --expected-branch br-dry-sun-awo6g12b
```

Without `--apply`, this checks existing tables. Only use `--apply` for the
reviewed additive SQL against the intended target. There is no schema creation
on an HTTP read. Deploy application changes through the repository's normal
review/merged-main workflow; the source schema alone does not deploy the UI.

## HTTP contract

Prefix: `/coach_api/coaching-recordings/quality`. All routes require the LMS
session cookie and a fresh Curriculum grant; writes also require normal CSRF.
The server takes the actor, coach, meeting and learner from authorized records.
It rejects client attempts to replace identity/context fields.

| Method | Suffix | Behavior |
| --- | --- | --- |
| GET | `/context?eventKey=...&reference=...&learnerId=...` | Authorized ended meeting, current coach caseload, template and existing review |
| POST | `/reviews?eventKey=...&reference=...` | Create one review for a selected caseload learner |
| GET | `/reviews?start=YYYY-MM-DD&end=YYYY-MM-DD&timeZone=Europe/London&coachEmail=...&status=completed&search=...&offset=0` | Up to 30 summaries and `nextOffset`; inclusive calendar-day boundaries; max 366 days |
| GET | `/reviews/<uuid>` | Canonical saved review and template |
| PUT | `/reviews/<uuid>` | Save the next version using the stored meeting/learner context |
| POST | `/reviews/<uuid>/images` | Multipart `section` and `image`; PNG/JPEG/WebP, max 5 MiB input, normalized server-side |
| GET | `/reviews/<uuid>/images/<uuid>` | Authorized image bytes for that review only |
| GET | `/reviews/<uuid>/pdf?version=N` | Real PDF of the current completed saved version; draft/stale version returns 409 |

### Saved review links

The Curriculum dashboard route is `/curriculum/coaching-recordings/reviews`.
Opening a saved review adds `review=<uuid>` to its query string. The applied
filters are `from`, `to`, `zone`, `coach`, `status` and `q`; `status=all` means
all saved statuses. Refresh and history restore the selected review and filters.
The UUID opens the canonical current version even when that review no longer
matches the list's status filter. Authorization is still checked by the server.
Invalid UUIDs are rejected explicitly; no signed meeting reference, media URL
or form content is included in this link.

Opening/closing a review does not refetch the summary list. Filters are applied
on submit, and changing/restoring filters restarts pagination at the first page.
Within this dashboard, query/history navigation preserves an in-flight save and
asks before discarding unsaved form changes. The form's explicit close and
browser-unload protection also remain in place.

Save body:

```json
{
  "learnerId": "verified-lms-learner-id",
  "expectedVersion": 0,
  "requestId": "fresh-uuid-reused-only-for-an-unchanged-retry",
  "status": "draft",
  "form": {
    "header": {"employer":"", "programme":"", "activityDate":"", "startDate":"", "endDate":""},
    "criteria": {"progress-1": {"rating":"", "evidence":""}},
    "actions": [], "images": {}, "sources": []
  }
}
```

Use the versioned template response for all 17 criterion IDs and descriptors.
Ratings are `gold`, `green`, `amber`, `red`, `na`; new forms start blank.
Completion requires all ratings and evidence for every non-N/A criterion.
Every nonempty completed SMART row requires `action`, `outcome`, `supportedBy`,
`dueDate`. `sources` are reviewer declarations, not automatic proof of viewing.
PUT must include the complete form; this is not a partial field-clearing API.

An unchanged retry with the same request ID/actor returns its exact saved
revision. A stale version, changed payload with reused request ID or concurrent
first creation returns 409. The browser retains edits and offers an explicit
reload; it never silently overwrites another reviewer. Versions, context and
history remain intact when a later draft/completion is saved.

## Coaching Session handoff (same record, no second write)

The source-app teammate should read `lms_quality.review.payload` and, if needed,
`lms_quality.revision` using their existing authorized **server-side** database
access. This is a data contract, not authorization to expose all reviews through
an unauthenticated endpoint. That app must apply its own staff/reviewer scope.
It should display the canonical saved review ID and version and must not create
another review/action row just to show it.

The snapshot contains:

- `meeting.eventId`, `meeting.onlineMeetingId`, `startsAt`, `endsAt` (UTC), title;
- `coach.email`, verified `learner.id` (LMS namespace), `learner.email` and name;
- template ID, reviewer identity, form, status, version and save timestamp.

Match a source meeting by its verified Microsoft identity, coach and UTC
occurrence, then use the verified learner email or an explicit ID mapping for
the learner. The LMS learner ID is not automatically a Coaching Session learner
ID. Names, titles or a recurring meeting link alone are insufficient. A missing
cross-app mapping must remain unmatched; never attach a different occurrence's
review to make a report appear.

Example parameterized server query (read only):

```sql
SELECT id, version, payload
FROM lms_quality.review
WHERE coach_email = %s AND starts_at = %s AND ends_at = %s
  AND payload->'meeting'->>'eventId' = %s
  AND payload->'learner'->>'email' = %s;
```

Use the snapshot's image UUIDs with the same `review_id` and section. Do not
retrieve all bytea images for a dashboard. Original AI/PDF remains owned by
Coaching Session; this review PDF represents the human observer's saved form.
Displaying this record in the separately hosted Coaching Session UI still
requires its teammate's implementation/release. This repository does not modify
or deploy that other application's source.

## Loading and verification

- No review read occurs when the calendar/drawer first opens. The form button
  loads its context on demand; typing does not send requests.
- Saves are explicit. List filters apply on submit, lists are paginated and have
  no polling. Opening a saved review uses its UUID and does not scan calendars.
- Client reads share in-flight requests, retain at most 16 keys for 15 seconds,
  and clear after a save or the existing global auth invalidation.
- PDF bytes use the configured Django cache (including existing Redis when
  configured), keyed by source database, review UUID, saved version and renderer
  version for 10 minutes. Authorization/current version is checked before cache
  access. Browser Blob cache: 30 seconds, three files, cleared by existing auth
  invalidation. Preview/download share the same bytes.
- No new Redis/configuration change is needed. Store connections have 3-second
  connect, 5-second statement and 2-second lock timeouts. Failed reads/writes
  remain errors; the UI retains unsaved edits.

Use the isolated SQLite runner for the existing mocked feature tests after
reviewing its configuration. Never run the default production provisioning test
runner. Browser verification uses intercepted synthetic API responses only.
PostgreSQL schema existence was verified live; review persistence/concurrency
tests used an isolated SQLite adapter, not real learner writes to the source.

## Ordered completion checklist (24 October 2026)

- [x] Verified the Coaching Session source, existing MCM/PR AI PDFs and report
  identity/occurrence boundaries before starting the new form.
- [x] Confirmed one independent review per learner/meeting and all current
  Curriculum users as reviewers.
- [x] Added isolated durable shared storage; idempotent retry, stale-save
  conflict, immutable context/history, caseload and CSRF tests passed before UI.
- [x] Built the nine-section, 17-criterion form popup. Draft/save/error recovery,
  keyboard and synthetic desktop/mobile checks passed before PDF work.
- [x] Built real saved-version PDF preview/download. Searchable content, all
  criteria, long evidence, screenshots, draft/version/auth rejection, cache
  reuse, actual PDF.js pages and identical download bytes were verified.
- [x] Added `/curriculum/coaching-recordings/reviews` and its calendar link;
  coach/date/status/search filters, pagination and on-demand saved form tested.
- [x] Persisted saved review UUIDs and applied filters in the URL; direct links,
  refresh/history, pagination reset and unsaved/in-flight-save protection were
  verified without extra list requests when opening a review.
- [x] Documented the shared source schema, stable matching IDs and read contract
  for the separately maintained Coaching Session application.
- [ ] The other application's teammate still needs to display this canonical
  record in that application's UI. This is an external handoff, not a second
  write or a completed deployment from this repository.
- [ ] PR review, merge and application deployment have not been performed.

Current local checks (24 October 2026):

```powershell
.\backend\.venv\Scripts\python.exe .qa-tmp/coaching_index_tests.py coach_api.test_quality_reviews
# PASS: 23 tests, isolated SQLite/LocMemCache, external services mocked.

cd frontend
npx vitest run src/pages/coaching-recordings src/api/coachingQualityReviews.test.ts src/api/coachingRecordings.test.ts src/pages/learner/monthly-submission/AssignmentPdfPreview.test.tsx src/lib/__tests__/coachFetch.test.ts src/router/__tests__/navigation.test.tsx src/router/__tests__/lazyRoute.test.ts --maxWorkers=2 --reporter=dot
# PASS: 235 tests in 20 files.
npm run type-check
# PASS.
npm run build
# PASS; build reports dependency eval/chunk-size/plugin-time diagnostics.
```

Scoped ESLint passed with `--max-warnings 0` for the changed quality dashboard,
dialog, URL helper and their tests. `git diff --check` passed. This follow-up
changed only those frontend quality files and this contract; the backend,
shared router, authentication and Teams behavior were not edited.

Private synthetic Playwright probes followed the actual form first, then the
dashboard and finally PDF: nine sections/17 criteria, explicit draft saves,
completion at saved version 3, UUID/filters retained after refresh, guarded
unsaved Back navigation and Back during a pending save. Typing sent no requests.
Refresh used one summary and one detail read; opening a review did not scan
calendars or eagerly load PDF/AI. Preview, reopening and download used one PDF
request and identical bytes. The PDF was rendered from that same saved test
form with the production renderer, and all four pages were visually checked.
Desktop/mobile layout and nested keyboard dismissal were also verified. No
learner data was used in screenshots or generated test PDFs. No real review,
evidence, email, Microsoft or AI operation was performed by these probes.

Teams baseline/expanded Teams checks: **NOT REQUIRED**. No Teams trigger file or
API imported by a listed Teams file was changed for this quality feature.
Live Teams: **NOT RUN**. The earlier schema-installation metadata check confirmed
the expected New era project/branch and zero review, revision and image records;
this follow-up made no database writes. Cross-app UI display, PR review, merge
and deployment remain outstanding as listed above.
