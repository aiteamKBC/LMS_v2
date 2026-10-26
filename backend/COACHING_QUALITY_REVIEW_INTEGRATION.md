# Coaching quality forms and saved review contract

## Scope and entry points

Curriculum users can edit separate **MCM** and **PR (Progress Review)** quality
forms, publish each for new reviews, and assess any coach calendar meeting.
The defaults come from **Quality 2 / Portfolio Sampling Feedback Form**: MCM has
eight sections / 15 criteria and excludes the Progress reviews section; PR has
eight sections / 14 criteria and excludes Monthly Coaching Meetings. Both retain
the seven common sections, rating descriptors, supporting screenshots and SMART
action plan. Historical reviews retain their original definition, including the
older shared nine-section / 17-criterion form. Questions support rating plus
evidence, short/long text, yes/no, single choice, checklist, date, number and image.

- Form authoring: `/curriculum/quality/forms?type=MCM` or `?type=PR`, also linked
  from Curriculum Quality, the calendar, saved checks and the selected meeting form.
- Meetings: `/curriculum/coaching-recordings`, with **Quality Check** in each drawer.
- Saved checks: `/curriculum/coaching-recordings/reviews`, linked as **Quality Checks**.

Every review is for one learner and one coach meeting occurrence. If the meeting
has no linked learner, the reviewer selects a learner from that coach's current
caseload. New reviews are supported for every category and phase, including
upcoming, in-progress and cancelled meetings. Completion and PDF are allowed at
any time, as requested. This does not change Microsoft meeting or attendance state.
The observer records their judgement; no rating or evidence is filled automatically.

Existing Curriculum grants, including the established super-admin hierarchy,
control authoring, reading and writing in LMS. Fresh server-side grants and CSRF
are enforced. A coach-only account cannot write through these endpoints.
The external Coaching Session maintainer will implement its own read-only viewer;
coaches there may see reviews of their own meetings only.

## Canonical database and additive schema

Kent organization, **New era**, project `fragrant-mountain-14750513`, branch
`br-dry-sun-awo6g12b`, database `neondb`. Use the existing server-side
`COACHING_SESSIONS_DATABASE_URL`; never expose that credential to the browser.
Existing source AI remains in the Coaching Session application, including
`public.all_sessions_cache` and `public.report_ai`. This quality feature makes
no AI request, copies no video and introduces no Azure store.

| Purpose | Canonical location |
| --- | --- |
| Current authoring draft and published definition | `lms_quality.form_template.payload` |
| Immutable authoring revisions | `lms_quality.form_revision` |
| Current saved review, answers and frozen questions | `lms_quality.review.payload` |
| Review UUID / current saved version | `lms_quality.review.id` / `version` |
| Immutable review snapshots | `lms_quality.revision` (`review_id`, `version`) |
| Normalized evidence screenshots | `lms_quality.image` (`review_id`, `section`, `id`) |
| Stored completed PDF bytes | `lms_quality.document.content` (`review_id`, `version`) |
| PDF name and integrity hash | `lms_quality.document.filename` / `digest` |

The initial v1 SQL installed review/revision/image on 24 October 2026. The
additive `coach_api/sql/coaching_quality_v2.sql` was applied to the verified target
on 25 October: form_template, form_revision, document and two lookup indexes.
Before applying it, the source project's 24-hour restore history and the target
project/branch/database were verified. A transaction used an advisory lock,
2-second lock timeout, 15-second statement timeout and explicit target guards.
Afterward all six tables existed, with zero reviews, revisions, images, templates,
form revisions and documents. No real learner review was inserted. Existing
meeting/AI/cache/transcript tables were not modified.

GET does not create schema or seed a form record. Until the first explicit form
save, the response supplies the original published version 1 and an unsaved copy
for editing. Do not store human reviews or PDFs in all_sessions_cache: rebuilding
that source cache must leave lms_quality intact.

Reviewed installation/check command, run from backend:

```powershell
python manage.py apply_coaching_quality_schema --schema-version 2 --expected-project fragrant-mountain-14750513 --expected-branch br-dry-sun-awo6g12b
```

Without `--apply`, this is an installation check. `--apply` runs the reviewed
additive v1/v2 SQL against the verified intended target. Application releases still
require the project's normal review and merged-main deployment process. Schema
installation does not deploy frontend or backend source. No destructive rollback
is needed for these additive tables; retain them and their records when reverting
application code. Do not drop them to roll back a release.

## Draft, publication and saved versions

Saving an authoring draft does not change meeting forms. Publish advances the
published form version for new reviews. Each saved review stores its exact
`definition`, including questions, types and descriptors. Later publication does
not rewrite saved answers, historical reviews or completed PDFs.

A form save uses `expectedRevision`, `requestId`, `definition` and boolean
`publish`. A review save uses `expectedVersion`, `requestId`, `learnerId`, `status`,
`form` and optionally `templateVersion`. The browser sends templateVersion;
a stale published definition when creating a review returns 409. Existing reviews
continue to validate against their own frozen definition. PUT is a complete form
save, not a partial field-clearing API. Actors and meeting/learner context remain
server-owned.

An unchanged retry reuses its request UUID and returns its original saved revision.
Changed requests must get a new UUID. Stale concurrent saves and changed payloads
reusing a request UUID return 409; the UI retains edits and offers explicit reload.
Review versions and form publication versions are separate counters.

Legacy ratings stay in `form.criteria` as `{rating, evidence}`; supported ratings
are gold, green, amber, red and na. Other typed values use `form.answers` keyed by
stable question IDs. Images use `form.images` keyed by an allowed screenshot
section or image question ID. Required values are checked on completion;
boolean false and number zero count as answers. Required ratings need evidence
unless N/A. Nonempty completed SMART rows require action, outcome, supportedBy
and dueDate. The form's header and reviewer-declared sources are also retained.
Image input is PNG/JPEG/WebP, at most 5 MiB, normalized to JPEG at most 1 MiB;
at most two referenced images per key and 20 retained images per review.
Save a draft before attaching images so ownership is established first.

Completing a review first persists its immutable revision, then prepares and
stores the branded PDF for that version. It contains the same frozen questions,
answers, screenshots and action plan. Preview/download reuse the stored bytes.
A later draft keeps the earlier completed PDF available with its version label.
A newer completed review always requests its own PDF, including when preparation
needs retry; it is not silently represented by an older PDF.

If PDF preparation fails, the review remains saved and the response explicitly
reports `document.state=failed` with its saved version. The UI displays the partial
failure and allows PDF retry. Success reports `document.state=ready`. Normal GET
review responses do not eagerly load document bytes.

## HTTP contract

Prefix: `/coach_api/coaching-recordings/quality`. All endpoints require an LMS
session and a fresh Curriculum grant; writes also require normal CSRF. These are
not public URLs and another site's cookie does not authenticate an LMS request.

| Method | Suffix | Result |
| --- | --- | --- |
| GET | `/form` | Authoring draft, published definition, revision and field types |
| PUT | `/form` | Explicit draft save or publish, optimistic revision and idempotent request UUID |
| GET | `/context?eventKey=...&reference=...&learnerId=...` | Authorized meeting, coach caseload, applicable definition and existing review |
| POST | `/reviews?eventKey=...&reference=...` | New review for selected coach caseload learner; completed saves include document state |
| GET | `/reviews?meetingId=<32-hex-occurrence-id>&offset=0` | Up to 30 metadata rows and nextOffset; no calendar scan or form/image/PDF bodies |
| GET | `/reviews?start=YYYY-MM-DD&end=YYYY-MM-DD&timeZone=Europe/London&coachEmail=...&status=completed&search=...&offset=0` | Filtered summaries, coaches and nextOffset; inclusive day boundaries, maximum 366 days |
| GET | `/reviews/<uuid>` | Current saved review and its frozen definition |
| PUT | `/reviews/<uuid>` | Next saved version using immutable meeting/learner context |
| POST | `/reviews/<uuid>/images` | Multipart section/question ID and image |
| GET | `/reviews/<uuid>/images/<uuid>` | Authorized image for this review only |
| GET | `/reviews/<uuid>/documents/<version>` | Real PDF of this immutable completed revision; works after a later draft |
| GET | `/reviews/<uuid>/pdf?version=N` | Compatibility URL; still requires the current completed saved version, stale/draft returns 409 |

The meeting metadata includes id, learnerId, learnerName, status, version,
reviewType, pdfVersion and updatedAt. pdfVersion is the latest physically stored completed
PDF, or null. The dashboard similarly contains summary data, not large evidence
or PDF bodies. Historical PDF access still rechecks current authorization.

Saved check links include `review=<uuid>`. Applied filters use from, to, zone,
coach, status, q, type and pdf. Refresh/history restore those selections; opening a saved
review does not trigger another list read. The form guards unsaved navigation and
in-flight saves. The authoring page also guards links, Back and page unload.

## Handoff to Coaching Session maintainer

The owner chose the other application's maintainer to implement that viewer.
Read the same canonical review and document from the New era database above,
through authorized server-side access. Do not create a second form/action record.
LMS routes are available for authenticated LMS consumers; direct database access
in the source app requires its own fresh active-account and ownership checks.

Before returning any payload, image or PDF, verify the coach owns that meeting
and occurrence. Match Microsoft event/online meeting identity, coach email, UTC
start/end and the learner mapping. LMS learner IDs are not automatically source
app learner IDs. Names, titles or a recurring join URL alone are insufficient.
Do not attach another occurrence's review to fill a missing result.

```sql
-- Parameters must come from verified server-side scope, not an untrusted coach ID.
SELECT id, status, version, updated_at, payload
FROM lms_quality.review
WHERE coach_email = %s AND starts_at = %s AND ends_at = %s
  AND payload->'meeting'->>'eventId' = %s
  AND payload->'learner'->>'email' = %s;

-- After verifying the selected review belongs to the signed-in coach/meeting:
SELECT filename, digest, content
FROM lms_quality.document
WHERE review_id = %s AND version = %s;
```

The snapshot contains meeting.id (stable LMS occurrence key), eventId,
onlineMeetingId, startsAt/endsAt, original title, verified coach/learner,
reviewer, frozen definition, form, status, saved version and timestamp.
Snapshots for a particular historical PDF are in revision.payload with the same
review_id/version. Image UUIDs must remain scoped to review_id and their saved
section/question ID. Fetch image/PDF bytes only on demand, not for list cards.
The other application must never expose all learner reviews through an anonymous
endpoint. Its requested coach viewer is read-only and own-meeting scoped.

## Requests, caches and verification limits

- Opening a meeting makes one paginated metadata read for its saved checks.
  It does not load the authoring definition, form detail, images or PDFs eagerly.
- Form/context, saved review and image reads are on demand. Typing sends no
  requests. Saves and refreshes are explicit. Lists have no polling.
- Client reads share in-flight requests; 15-second metadata cache holds at most
  16 keys and clears on save/auth invalidation. PDF Blob cache holds at most three
  files for 30 seconds. Form, meeting drawer and dashboard use the same immutable
  document URL so preview/download share a request and bytes.
- Completed PDF bytes persist in document even after process/cache restart.
  The configured Django cache, including existing Redis when configured, reuses
  source-database/review/version-scoped bytes for 10 minutes. Fresh authorization
  runs before cache access. No Redis or environment configuration was changed.
- Source store connections retain 3-second connect, 5-second statement and
  2-second lock timeouts. Failures stay visible; no fabricated empty success.

Use `config.settings_coaching_recordings_test` for isolated SQLite aliases,
LocMemCache/mail and disabled automatic jobs. Routine tests mock external
services. Synthetic browser probes intercept API requests and use no real learner
data. They check desktop/mobile forms, explicit save/publish, image upload,
completion of a future meeting, PDF.js popup and identical download bytes.
The five-page custom-form PDF was visually inspected. One PDF render and one PDF
HTTP read served form preview, download and the meeting's saved attachment.
This is mocked integration evidence, not a live authenticated learner save.

Current local validation results are recorded in the task handoff. Teams baseline
and expanded Teams checks are NOT REQUIRED for this quality-only change: no Teams
trigger file or shared Teams API contract was edited. Live Teams was NOT RUN.
Unrelated existing Teams changes in the working folder were preserved separately.

No Pull, Merge, Commit, Push, branch switch or deployment was performed for this
implementation. It remains local on the owner's current branch. The schema
addition above is the only live external write in this task. External Coaching
Session UI implementation, review and application release remain separate.

## Final local checks - 25 October 2026

All checks below passed against the final implementation; no tests were weakened.

```powershell
.\backend\.venv\Scripts\python.exe backend/manage.py test coach_api.test_recordings_api coach_api.test_recordings_calendar_media coach_api.test_recordings_calendar_no_db coach_api.test_recordings_categories coach_api.test_recordings_evidence_api coach_api.test_recordings_index coach_api.test_recordings_jobs coach_api.test_recordings_keywords_no_db coach_api.test_recordings_links coach_api.test_recordings_pdf coach_api.test_recordings_quality coach_api.test_recordings_response_cache coach_api.test_recordings_saved_evidence coach_api.test_recordings_transcripts coach_api.test_recordings_transport coach_api.test_quality_reviews coach_api.test_quality_form_builder coach_api.test_completion_reminders --settings=config.settings_coaching_recordings_test --noinput
# PASS: 397 tests, SQLite/LocMemCache/mail; external service calls mocked.

cd frontend
npx vitest run src/pages/coaching-recordings src/api/coachingQualityReviews.test.ts src/api/coachingRecordings.test.ts src/api/coachingCompletion.test.ts src/pages/notifications/CompletionNotifications.test.tsx src/pages/learner/monthly-submission/AssignmentPdfPreview.test.tsx src/lib/__tests__/coachFetch.test.ts src/router/__tests__/navigation.test.tsx src/router/__tests__/lazyRoute.test.ts --maxWorkers=2 --reporter=dot
# PASS: 259 tests in 25 files.

npx eslint src/pages/coaching-recordings src/api/coachingQualityReviews.ts src/api/coachingQualityReviews.test.ts src/pages/curriculum/hubs/page.tsx src/router/config.tsx --max-warnings 0
# PASS.

cd ..
npm --prefix frontend run type-check
# PASS.
npm --prefix frontend run build
# PASS: 28.42 seconds; dependency eval/chunk-size/plugin-time diagnostics remain.
git diff --check
# PASS.
```

The browser probe used real React form components and PDF.js with synthetic,
intercepted API responses. It confirmed zero page errors, no mobile horizontal
overflow, 19 custom questions, learner selection, image upload, separate draft
and publish, future meeting completion, one PDF render, one PDF read and identical
download bytes. The real PDF renderer produced five searchable pages with the
KBC logo and correct Unicode punctuation. This does not claim live Microsoft or
real learner save verification. All five pre-existing unrelated modified files
retained their original hashes, and the Git index remained empty.

A final read-only source query verified the exact project/branch/database above
and zero rows in all six quality tables. Reviews appear there only after a real
user explicitly saves a form. The schema was applied; application code remains
local on `khaled-is-here`, HEAD `9422c852`, with no Git mutation or deployment.

## Separate MCM / PR forms and simpler filters - 25 October 2026

### Selection and review history

- The form starts with two native radio controls, MCM and PR. A verified saved
  review's manual choice takes precedence; otherwise the meeting title suggests
  the type. Monthly Coaching Meeting/Review and MCM/MCR suggest MCM. Progress
  Review and PR/legacy BR suggest PR. An unknown title requires an explicit
  choice before answering/saving; all meeting categories remain reviewable.
- `titleType` is an optional client hint from the displayed calendar title. It
  is used only when no saved choice or server title suggestion exists. It never
  authorizes a meeting or replaces its identity. Explicit `reviewType` is the
  reviewer override. Microsoft category, booking, title, attendees and dates do
  not change when selecting a quality form type.
- Switching loads that type's published questions. Unsaved answers require a
  discard confirmation. A saved review is corrected by another revision of the
  same review ID and learner/meeting identity; the previous answers, definition,
  screenshots and completed PDFs remain in immutable history. Merely selecting
  or previewing another type writes nothing.
- A form edit has its own draft, optimistic revision and published version for
  each type. Changing MCM cannot publish into PR. The first typed definition
  inherits applicable/common legacy customisations without modifying the legacy
  template. Afterwards each saved typed definition is independent. Existing
  review definitions remain frozen until an explicit type correction.

### Additive API fields and filters

| Request | Meaning |
| --- | --- |
| `GET /form?reviewType=MCM` (or PR) | That type's authoring state and supported field types |
| `PUT /form?reviewType=PR` | Save/publish only PR; definition.reviewType must match the query |
| `GET /context?...&reviewType=PR` | Preview the PR form for the already authorized meeting/learner |
| `GET /reviews/<uuid>?reviewType=MCM` | Preview an MCM correction to this saved review, without a write |
| `POST /reviews?...` / `PUT /reviews/<uuid>` | Optional reviewType MCM/PR in the normal save body; same CSRF/version/idempotency rules |
| `GET /reviews?...&reviewType=PR&pdf=available` | Metadata only, PR reviews with any physically saved historical PDF |

`reviewType` is additive on review snapshots and list/meeting summaries. The
legacy `templateId` stays compatible; `definition.id` identifies the frozen
typed template. Untyped older rows are classified from their original meeting
title for filtering. The new template row IDs in `lms_quality.form_template` are
`portfolio-sampling-v1-mcm` and `portfolio-sampling-v1-pr`. Existing JSON payload
columns support this change; no schema migration or history rewrite is needed.
No typed row is inserted merely by opening the editor: normal explicit saves
create/update it with revision history.

Saved checks have quick All types/MCM/PR and All saved/Completed/Drafts/With PDF
buttons. Coach/search stay immediately available; date/time-zone/PDF filters
expand on demand. Quick choices retain entered search text. Invalid periods
open their fields with a clear error before sending a request. Reset restores
all types/statuses and the last 31 days. Search typing does not issue requests,
filters are reflected in the URL, pagination is bounded, and the list has no
polling or eager PDF/image/form-detail reads.

### Endpoint handoff for the Coaching Session maintainer

Using an authenticated LMS session with current Curriculum access:

```text
GET /coach_api/coaching-recordings/quality/reviews?meetingId=<LMS-32-hex-occurrence-id>&offset=0
GET /coach_api/coaching-recordings/quality/reviews/<review-uuid>
GET /coach_api/coaching-recordings/quality/reviews/<review-uuid>/documents/<pdfVersion>
```

The first response returns paginated metadata with id, learnerId, learnerName,
reviewType, status, version, pdfVersion and updatedAt. Follow nextOffset to read
additional learners. When pdfVersion is non-null, the last URL returns that
immutable PDF; it remains accessible after a newer draft/type correction.
The middle URL returns the current saved form and frozen definition.

The stable meetingId is the LMS occurrence ID in the calendar's `meeting=` URL,
not an onlineMeeting ID or reusable join link. The source application's own
session does not authenticate an LMS call. Its maintainer may instead read the
same canonical `lms_quality.review`, `revision`, `image` and `document` tables
server-side using its fresh coach/occurrence ownership checks described above.
Do not create a duplicate review, a public endpoint, or a second PDF record.

### Verification checklist for the type split

- [x] Title suggestions, legacy BR/MCR aliases and unclassified titles.
- [x] Saved manual selection takes precedence over a calendar title hint.
- [x] Separate applicable MCM/PR defaults and independent draft/publication state.
- [x] Switching form type protects unsaved answers and preserves review identity,
  optimistic versions, old answers/images and immutable completed PDFs.
- [x] All existing question types, checklist, image upload, logo, completion and
  responsive PDF preview/download still work.
- [x] Coach/search, type/status/PDF quick filters, invalid-date feedback, Reset,
  URL/history restoration and bounded pagination.
- [x] Fresh Curriculum grants, denied/revoked roles, CSRF, save conflicts and
  explicit request IDs remain covered by regression tests.
- [x] Typing makes no request; lists do not poll or download PDF bodies eagerly.
  Type/learner/reference cache keys are separate, and PDF bytes are reused.

Final scoped test commands (repository root unless noted):

```powershell
.\backend\.venv\Scripts\python.exe backend/manage.py test coach_api.test_recordings_api coach_api.test_recordings_calendar_media coach_api.test_recordings_calendar_no_db coach_api.test_recordings_categories coach_api.test_recordings_evidence_api coach_api.test_recordings_index coach_api.test_recordings_jobs coach_api.test_recordings_keywords_no_db coach_api.test_recordings_links coach_api.test_recordings_parts coach_api.test_recordings_pdf coach_api.test_recordings_quality coach_api.test_recordings_response_cache coach_api.test_recordings_saved_evidence coach_api.test_recordings_transcripts coach_api.test_recordings_transport coach_api.test_quality_reviews coach_api.test_quality_form_builder coach_api.test_quality_review_types coach_api.test_completion_reminders --settings=config.settings_coaching_recordings_test --noinput
# PASS: 421 tests, 6.014 seconds. SQLite aliases, memory cache/mail and mocked external services.

cd frontend
npx vitest run src/pages/coaching-recordings src/api/coachingQualityReviews.test.ts src/api/coachingRecordings.test.ts src/api/coachingCompletion.test.ts src/pages/notifications/CompletionNotifications.test.tsx src/pages/learner/monthly-submission/AssignmentPdfPreview.test.tsx src/lib/__tests__/coachFetch.test.ts src/router/__tests__/navigation.test.tsx src/router/__tests__/lazyRoute.test.ts --maxWorkers=2 --reporter=dot
# PASS: 289 tests / 26 files, 57.71 seconds.
npx vitest run src/pages/coaching-recordings/QualityReviewDialog.test.tsx src/api/coachingQualityReviews.test.ts --maxWorkers=2 --reporter=dot
# PASS: 15 tests / 2 files after the final empty/omitted legacy type contract check.
npx eslint src/pages/coaching-recordings src/api/coachingQualityReviews.ts src/api/coachingQualityReviews.test.ts --max-warnings 0
# PASS.
cd ..
npm --prefix frontend run type-check
# PASS.
npm --prefix frontend run build
# PASS: 29.38 seconds; dependency eval/plugin-time diagnostics remain visible.
git diff --check
# PASS.
```

Synthetic Playwright used the real form/editor/dashboard, API client, PDF.js and
PDF renderer with intercepted APIs and synthetic records. It checked desktop
and 390px mobile layouts, separate MCM/PR publication, image/checklist questions,
future-meeting completion, correction from completed MCM v2 to PR draft v3 on the
same review, and continued access to the saved MCM v2 PDF. One render and one
PDF read served preview/download and the meeting attachment; downloaded bytes
matched. There were zero page errors or horizontal overflow. The typed MCM PDF
was visually inspected; real PDF text/logo/own-section/common-section checks
also passed for both default types. Browser API responses were synthetic, not
an authenticated live learner save.

A separate explicit read-only source connection verified database neondb and
the lms_quality tables. PostgreSQL accepted the new type/PDF filter plan and the
real metadata queries. transaction_read_only was on; no source writes or schema
changes were performed. Default typed rows are created only by a user's normal
explicit save/publish action.

The project-wide `npm --prefix frontend run lint` remains FAIL: 30 errors and
139 warnings in 92 files verified unchanged from HEAD. Scoped quality lint is
PASS. Vitest also emitted an act warning from the PDF viewer test; its assertions
passed, and actual PDF.js browser preview was separately checked.

Teams baseline / expanded Teams checks: NOT REQUIRED; this follow-up changes
only quality handlers, types, templates, filters and their UI. No Teams trigger
file or shared Teams contract was edited. Live Teams: NOT RUN. The five unrelated
teammate changes and earlier calendar/recording work were preserved by hash.
The Git index remains empty on khaled-is-here, HEAD 9422c852. No Pull, Merge,
Commit, Push, branch/worktree change or deployment was performed.
