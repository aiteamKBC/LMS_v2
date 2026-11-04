# Curriculum video storage on Bunny

Curriculum video components can store MP4 uploads and downloadable video links
in Bunny Stream library `798153`. The server selects an existing collection from
the saved programme. Programme, cohort, group, module and component identifiers
and names are sent as `lms.*` metadata. The library API key stays on the backend.

Keep the existing programme collections. Bunny video titles start with the module
name, for example `MSP — Recorded session P1: ...`; the recovery marker
`[LMS:<import-id>]` follows the title. MSP's full LMS module title is displayed as
`MSP`. Assigned week templates use their module's name; an unassigned template
uses its own name. No per-module collections are created. Recovery accepts both
the earlier marker-first titles and the new module-first titles.

New or changed video sources saved through Module Builder, Component Builder and
Week Builder are queued. Migration 0078 also captures source changes directly in
`curriculum.components` and `curriculum.week_template_components`, so an external
integration (including ChatGPT) writing those tables does not need to call a
special API endpoint. The component must be saved as `type=video`, with its
parent module/template and a `settings_json.videoUrl` or `embedCode` source.
Save also requests a copy of the currently selected video, even when its source
is unchanged, and retries a failed copy. A completed copy is reused. There is no
separate import button in the editor. Saving unrelated content does not request
historical sibling videos; the module-scoped command remains available for an
explicit historical import.
Unassigned templates need a programme before a collection can be selected.

Linked videos keep their original LMS playback source while a copy is stored on
Bunny. At the user's follow-up request, MP4 device uploads also save a playable
LMS source: the existing curriculum file store retains the MP4 (Azure when
configured, otherwise MEDIA_ROOT), and the component receives its stable LMS
`videoUrl`, `HTML (MP4)` source type and upload metadata. The editor receives the
same fields, so a later save does not erase the uploaded source. Other component
settings and learner progress are preserved.

Bunny completion only records the library, collection, video ID and status in
the import journal; it never replaces the saved source with a Bunny player URL.
A source changed during transfer is marked superseded, while the stored copy
remains on Bunny. Teams meeting/recording synchronization is not part of this
importer.

## Automatic detection independent of the uploader

- A PostgreSQL trigger appends a `curriculum_video_change` event in the same
  transaction as the source write. A rollback removes both; the worker sees the
  event only after commit. The trigger performs no downloads or remote calls.
- The existing supervised worker reads committed events, resolves the current
  programme/cohort/group/module, and queues the existing import workflow. Events
  and imports survive worker restarts. The idle worker checks every 15 seconds;
  transfer time and backlog affect when a video finishes.
- Existing API saves and database events reuse the same import fingerprint.
  Delayed events cannot supersede a newer file upload. Replaced/deleted sources
  and equivalent embed edits are discarded without modifying LMS content.
- Capture failures retain the event, a safe error and a retry time (one to five
  minutes). A programme assigned in a later transaction is picked up on retry.
  Source-download/Bunny failures remain in the existing import status
  and can be retried by saving the selected video again. No success is fabricated.
- The trigger function has a fixed search path and only writes the qualified
  event table as its owner. Existing SQL writers do not need new table grants or
  Bunny credentials. Its execution privilege is revoked from PUBLIC.
- Installation does not scan or backfill old videos. Events start at migration
  installation, remain queued while the worker is disabled, and are drained
  after activation. An MP4 supplied through the video upload endpoint saves its
  LMS source and queue entry in one transaction after storing the bytes. The
  worker can read that stored file after a request timeout or worker restart.
  A file copied onto disk without a saved
  Curriculum video source is not an observable Curriculum upload.

PostgreSQL documents [trigger transactions](https://www.postgresql.org/docs/current/trigger-definition.html)
and [SKIP LOCKED for concurrent queue consumers](https://www.postgresql.org/docs/current/sql-select.html).

## Supported sources and limits

- MP4 device uploads, up to the existing 300 MB curriculum upload limit. The
  retained LMS playback file is separate from the Bunny copy; it is not deleted
  when Bunny finishes. Bunny transfer/encoding runs after the upload response.
- Public video file URLs and downloadable public Google Drive files, including
  the large-file confirmation page. Public SharePoint download links can work;
  sign-in pages and restricted shares return a visible error.
- YouTube watch, short, mobile and embed URLs are normalised to one video ID.
  A backend subprocess uses `yt-dlp` to download the video, and FFmpeg combines
  audio and video when needed. Bunny receives the completed file immediately.
  Playlists and active/upcoming livestreams are refused. Sign-in, unavailable,
  rate-limit and extraction failures remain visible; they never create an empty
  Bunny video or claim success. No browser cookies or account credentials are used.
- YouTube temporary media are removed after upload, including when downloading
  or uploading fails. The downloader has a 20-minute timeout, the same 300 MB
  limit, bounded retries and no database/Bunny/Microsoft credentials in its
  environment. It downloads only the canonical YouTube video URL.
- Requests pin validated public IP addresses and validate every redirect. Local,
  private and credential-bearing URLs are refused. Downloads are bounded in size
  and time, and HTML is never treated as an uploaded video.

The shared LMS video player is unchanged. Bunny playback security is outside
this storage workflow; the user confirmed playback works in the Bunny dashboard.

## Deployment

Follow AGENTS.md: review and merge into main, verify the server checkout and
database target, retain a restore point and previous build, then deploy one
release. Do not enable imports before the new table exists.

1. Install the reviewed backend requirements. YouTube support pins
   `yt-dlp==2026.10.26`, `yt-dlp-ejs==0.8.0` and `imageio-ffmpeg==0.8.1`.
   The worker also needs Node.js 22+ on PATH (local verification used 24.11.1).
   The FFmpeg Python wheel supplies its executable; no system-wide FFmpeg install
   or runtime package downloading is performed by the importer.
2. Apply migrations `curriculum_api.0077_curriculum_video_import` and
   `curriculum_api.0078_curriculum_video_changes` on the verified application
   database. They add the import journal, change-event table and triggers on the
   two authoring component tables. They do not rewrite existing component or
   learner data. Both source tables must exist; a missing table fails migration
   rather than silently disabling part of the detector.
3. Configure backend environment values:

   ```dotenv
   BUNNY_STREAM_LIBRARY_ID=798153
   BUNNY_STREAM_API_KEY=<library-specific Stream API key>
   BUNNY_STREAM_ENABLED=true
   ```

4. Build the frontend and restart services using the repository deployment
   procedure. Keep the existing Bunny playback-domain/security settings.
5. Run `python manage.py process_curriculum_videos --watch` under the established
   service supervisor. It drains the durable queue and checks encoding every
   15 seconds. Save/status requests also wake a bounded worker; the supervised
   command provides recovery when browsers or web workers exit. It is required
   for automatic detection of writes made outside the LMS web application.

Turn `BUNNY_STREAM_ENABLED=false` and stop the video worker to stop new imports.
Keep both queue tables, triggers and uploaded files on rollback; stopping the
worker preserves pending events. Each import retains its
original source; no playback URL restoration is needed because imports do not
rewrite component sources. Keep the LMS MP4 files as well: their saved URLs are
used for learner playback independently of Bunny availability.

## Scoped existing-module import

Inspect first; this command does not upload without `--apply`:

```powershell
python manage.py import_curriculum_videos --module-id <module-catalogue-id>
python manage.py import_curriculum_videos --module-id <module-catalogue-id> --apply
```

The MSP pilot target is `MOD-20260930110509069516DE05CBE11E6E`, Project Controls
Professional Level 6, Feb 2026, G1. Inspection on 2026-11-03 found 176 populated
video components: 158 YouTube links, 17 Google Drive links and one SharePoint
link. The eligible sources must be checked individually; these are source counts,
not a claim that every file was migrated.

Pilot imports performed before deployment have a local, ignored manifest. Adopt
those existing Bunny identities after deployment instead of uploading duplicates:

```powershell
python manage.py import_curriculum_videos --module-id <module-catalogue-id> --apply --adopt-manifest <local-manifest.json>
```

Adoption checks the remote library, collection, programme/cohort/group and
module/component metadata, plus the pilot identity derived from the unchanged
original source. A later source change refuses adoption.
Do not commit runtime manifests, signed source URLs or credentials.

## API and verification

`GET /curriculum_api/curriculum/videos/{module|template}/{targetId}/{componentId}/`
returns status and the saved scope. `POST` imports the saved source, or accepts
multipart `file`, `title`, `programme_id`, `cohort_id`, `group_id`. The submitted
scope is checked against server records. Both endpoints require an LMS admin or
staff session; writes also require CSRF. Save new components before uploading.
Module/Week Builder Save includes `importVideoComponentIds` for the open video;
the backend accepts only saved video rows belonging to that request's parent.
This is request metadata, not a component setting. New/changed sources continue
to be detected without this field. An unchanged Week Builder Save omits the
component list, so requesting a copy does not replace sibling component rows.
The component save endpoint also requests its saved source. A failed save never
starts the requested transfer; the worker is awakened only after commit.
Status GET returns `saved: false` for a new component under a saved parent. The
editor allows file selection and explains that Save starts the upload.
An MP4 response includes `savedSettings`, a narrow patch for the editor's current
component. Status polling never applies settings to an open draft. Concurrent
source/scope changes during file storage are rejected; unrelated settings are
preserved. A failed Bunny copy does not remove the playable LMS file.

For a new component, Choose File is available before its first Save. The editor
retains the selected MP4 while switching between component inspectors. Save first
persists the component, then sends its file to the existing upload endpoint; a
failed authoring save does not upload the file. A failed file transfer retains
the selection for the next Save. Discard clears pending selections, and existing
unsaved-change guards include them. Files are held only in the open editor, never
in authored settings or browser storage. An already saved component keeps its
existing immediate MP4 upload behavior.

Run the isolated backend regression suite from `backend`:

```powershell
.\.venv\Scripts\python.exe -m curriculum_api.run_video_import_tests
```

It applies migrations 0077/0078 to an empty in-memory SQLite database and runs the
transport, source validation, YouTube subprocess/cleanup, authorization, retry
and source-preservation tests
with external network calls blocked. It does not replace the required expanded
Teams PostgreSQL integration checks.

Verify actual PostgreSQL triggers with a fresh **empty local test database**.
The runner checks the actual database name, address, port and server data
directory before writing fixtures. Its private connection JSON has `host`,
`port`, `dbname`, `user`, `password`; only `127.0.0.1` and database names starting
with `kbc_bunny_test_` are accepted. It refuses a nonempty database and blocks
external network connections.

```powershell
.\.venv\Scripts\python.exe -m curriculum_api.run_video_postgres_tests --connection-file <private-test-connection.json> --data-directory <verified-local-cluster-directory>
```

From the repository root:

```powershell
npm --prefix frontend test -- src/pages/curriculum/shared/CurriculumVideoUpload.test.tsx src/components/feature/__tests__/VideoPlayerFallback.test.tsx src/pages/curriculum/module-builder/__tests__/componentUpload.test.ts src/pages/curriculum/module-builder/__tests__/learnerPreview.test.tsx --maxWorkers=2
npm --prefix frontend run test:teams
npm --prefix frontend run type-check
npm --prefix frontend run lint
npm --prefix frontend run build
```

Teams checks apply because shared authoring endpoints are consumed by the Teams
module workflow. No live Microsoft operations
are needed to validate this change.

## Verification on 2026-11-03

- SQLite backend command above: PASS, 78 tests, migrations 0077/0078 applied to fresh
  in-memory SQLite; remote calls mocked and network blocked.
  This includes module title formatting, legacy/new recovery markers,
  title-only updates and module/template scope selection.
- PostgreSQL backend command above: PASS, 89 tests on a newly initialized,
  isolated local PostgreSQL 18.6 cluster with synthetic data. The exact local
  invocation from `backend` was
  `.\.venv\Scripts\python.exe -m curriculum_api.run_video_postgres_tests --connection-file ../.qa-tmp/bunny-postgres-test.json --data-directory $bunnyTestConfig.data_directory`,
  where `$bunnyTestConfig` was loaded from that ignored private connection file.
  Both real migrations ran. Cases cover direct SQL inserts/source updates,
  module/template scoping, unchanged historical videos, transactional rollback
  and commit visibility, concurrent workers, a writer without queue privileges,
  deduplication and a complete SQL-to-mocked-Bunny transfer preserving the source.
  The initial harness attempt stopped during Windows asyncio initialization
  before tests; its network guard was corrected to allow local socketpair
  connections while continuing to block external connections. Final run passed.
  These tests used synthetic video tables and mocked Bunny, not the application
  database or live storage. The owned local test server was stopped afterward.
- Frontend feature command above: PASS, 26 tests in four files.
- `npm --prefix frontend run test:teams`: PASS, 146 tests in nine files.
- `npm --prefix frontend run type-check`: PASS.
- `npm --prefix frontend run lint`: PASS.
- `npm --prefix frontend run build`: PASS; bundler emitted dependency eval and
  plugin timing warnings.
- Isolated expanded backend cases: PASS, 47 tests via
  `.\backend\.venv\Scripts\python.exe .qa-tmp/run-bunny-tests.py --teams`.
  This ignored local runner used in-memory databases and blocked network calls.
  Cases cover curriculum multi-day recurrence/attendance roster, learner Teams
  eligibility/sync, coach error handling, options retry and endpoint guards.
- Full PostgreSQL-backed meeting/calendar suites: NOT RUN in this detector
  follow-up; no Teams file or shared Teams function/API contract was changed.
  The earlier release-wide gate remains outstanding. Standard Django SQLite setup
  fails during schema creation on schema-qualified application tables, before
  executing tests. The isolated checks do not establish PostgreSQL integration.
  The newly verified local video test database contains only minimal synthetic
  video fixtures; it does not provide the full Teams schema/fixtures. This leaves
  `CurriculumTeamsMeetingTests`, `TeamsCalendarSyncVerdictTests` and
  applicable coach calendar race/ownership integration cases outstanding.
  The attempted standard runner from `backend` was
  `.\.venv\Scripts\python.exe manage.py test curriculum_api.test_video_imports --settings=config.settings_sqlite_test --testrunner=django.test.runner.DiscoverRunner --noinput --verbosity=1`;
  it stopped before tests with SQLite `OperationalError: near ".": syntax error`.
- Live Teams: NOT RUN. No Microsoft meetings, invitations or tenant settings
  were changed.
- Live Bunny pilot: the 165,630,768-byte MSP Fundamentals P1 source uploaded to
  video `3d6a9b85-a785-4242-8510-86293faeb50b` in the existing PCP collection.
  Bunny recognised a duration of 1,697 seconds and retained the original file.
  Bunny finished encoding (status 4). The earlier external iframe check returned
  a 403 page; the user subsequently confirmed playback works in Bunny and
  clarified that only storage is requested. Playback is not a storage blocker.
- Live YouTube pilot: `MSP Revision Rap: Big Programme, Bigger Cuppa | Kent
  Business College` downloaded on the backend and uploaded to video
  `9f901970-d567-4937-9753-b5fb3135ca29` in library 798153's existing PCP collection.
  The file is 15,111,157 bytes; Bunny finished encoding (status 4), duration
  212 seconds. Remote metadata confirms PCP / Feb 2026 / G1 and the correct
  module/component. A read-only database query verified both pilot components
  still have their original Drive/YouTube source identities. No YouTube temporary
  directories remained after upload.
- Both pilot videos were renamed on Bunny to start with `MSP —`. Remote reads
  verified the final titles, unchanged PCP collection and metadata, and encoding
  status 4 for both videos. The library still has five programme collections;
  none were created or removed. This title-only follow-up does not edit Teams
  files or change authoring API contracts, so no further Teams baseline is
  required. The release-wide PostgreSQL checks above remain outstanding.
- `.\backend\.venv\Scripts\python.exe -m pip check`: PASS. The project keeps
  its existing dependency pins, including certifi; only the three YouTube/FFmpeg
  packages above were added to requirements.

During the initial MSP pilot, the application database was read only and its
schema was unchanged. The later migration application is recorded below.
Component sources, learner data and production source files were not changed.
Secrets and runtime manifests are ignored and must not be committed.

The live pilot uploads and title updates do not enable automatic imports on the
running LMS. Before the migration follow-up below, read-only verification found
the import table absent from the configured application database. After deployment and activation, new/changed
Curriculum video sources enter the import queue (including direct writes captured
by the new database triggers), and the new video file control
uploads MP4 to Bunny. Other LMS attachments and existing videos are outside the
automatic upload scope. Queued/failed/ready states must remain visible; saving a
link does not itself prove that Bunny received its media.

## Migration application on 2026-11-03

At the user's explicit request, migrations `0077_curriculum_video_import` and
`0078_curriculum_video_changes` were applied to the LMS database configured in
`backend/.env`. The direct and pooled endpoints were verified to identify the
same database. Migration files matched merged main `01a809bb` (PR #563), and
Django's migration plan contained only these two forward migrations; 0076 was
already applied.

A custom-format schema archive of `public` and `curriculum`, including their
existing privileges, was created and validated with `pg_restore --list` before
the change. The archive, migration history and rollback notes remain in the
ignored local `.qa-tmp/bunny-migration-20261103T180845Z/` directory. No learner
rows were exported.

Django's migration executor applied both migrations and their recorder entries
in one transaction, using a migration-only configuration with no application
startup workers. Read-only checks after commit verified both migration records,
both new queue tables and enabled `bunny_video_source_changed` triggers on
`curriculum.components` and `curriculum.week_template_components`. Both queues
were empty immediately after application; no historical video backfill ran.

This was a database-only operation, not a verified server deployment. It did not
change environment files or start a video worker. Production service activation,
worker supervision, request timeouts suitable for MP4 uploads, the outstanding
release checks and a new-video production smoke check remain to be verified.
Teams checks were not required for this migration application; no Teams source
file was edited and no live Microsoft operation was performed.

## MP4 playback follow-up on 2026-11-04

The device upload previously sent bytes to Bunny without saving a playable LMS
source or updating the editor. New uploads now retain a file in the existing
curriculum store, atomically save its source and import job, and return the source
settings to Module Builder/Week Builder. The worker reads the retained file and
copies it to Bunny independently. The normal authoring validator now accepts
these generated MP4 paths, so subsequent saves and QA/approval keep working.
No new migration, dependency or environment setting is required for this fix.

An LMS storage failure preserves the previous source. A Bunny failure preserves
the new playable file and remains visible in import status. Source/scope conflicts
do not overwrite a newer saved video; unrelated content/progress settings survive.
Repeat uploads of the same file reuse the saved path and import identity. The
editor ignores late upload settings when the author has chosen another source.

Read-only production inspection confirmed the reported MP4 was ready on Bunny
but had not supplied an LMS source. Its component now has a YouTube link added
afterwards; the user explicitly chose to keep that link. No production rows,
Bunny files, credentials or environment files were changed in this follow-up.
The later YouTube copy failed because the server reported missing downloader
dependencies; installing the existing requirements remains a separate server step.

Final checks on the changed code:

- `python -m curriculum_api.run_video_import_tests` using the backend virtualenv:
  PASS, 104 tests on in-memory SQLite, including existing local/Azure storage and
  range-serving regressions; all external network access blocked.
- `python -m curriculum_api.run_video_postgres_tests --connection-file ../.qa-tmp/bunny-postgres-test.json --data-directory $bunnyTestConfig.data_directory`
  using the backend virtualenv: PASS, 123 tests on a verified fresh empty local
  PostgreSQL database with synthetic tables. Includes MP4 bytes/range responses,
  module/template source persistence, queue deduplication, retry after Bunny
  failure, rollback, concurrent source/scope edits and authoring validation.
  Bunny/Azure calls were mocked; no live upload was used as a regression test.
- The four-file frontend feature command above: PASS, 30 tests.
- `npm --prefix frontend run type-check`: PASS.
- `npm --prefix frontend run lint`: PASS.
- Teams baseline: PASS, 146 tests via `npm --prefix frontend run test:teams`.
  Required because the narrow video validation fix edits `curriculum_api/views.py`.
- Isolated expanded backend checks: PASS, 47 tests via
  `.\backend\.venv\Scripts\python.exe .qa-tmp/run-bunny-tests.py --teams`.
  Live Teams: NOT RUN. The broader PostgreSQL meeting/calendar integration gate
  listed above remains BLOCKED by the missing full synthetic Teams schema/fixtures;
  the local video database is not a substitute for those cases.

The first new PostgreSQL test attempt exposed a fixture assertion treating raw
JSON as an already-decoded dict; the assertion was corrected without changing
application semantics. The added HTTP storage cases initially lacked Django's
test-host setup. Both isolated runners now use Django's normal test-environment
setup/teardown; application host restrictions and test assertions are unchanged.

This fix still requires review, merge, deployment and a new MP4 production smoke
check. It has not been deployed or tested through the production learner UI.

## Save-triggered copy follow-up on 2026-11-04

The separate `Import saved video link` button has been removed. Ordinary Save
requests Bunny storage for the selected video in Module Builder and Week Builder,
including an unchanged link or a failed prior attempt. The standalone component
save also queues its source. Existing new/changed-source detection remains active.
Ready imports are reused, active transfers keep their lease, and requests cannot
select a component outside the saved parent. The LMS playback source is unchanged.
Unsaved components show a neutral Save instruction instead of an import error.

Validation used synthetic fixtures and mocked remote services only:

- `python -m curriculum_api.run_video_import_tests` from `backend` with its
  virtualenv: PASS, 111 tests, in-memory SQLite with external network blocked.
- `python -m curriculum_api.run_video_postgres_tests --connection-file ../.qa-tmp/bunny-postgres-test.json --data-directory $bunnyTestConfig.data_directory`:
  PASS, 132 tests on a verified fresh empty local PostgreSQL database. Includes
  Save/trigger deduplication, commit visibility, and rollback of both the source
  update and trigger event when queue creation fails. The owned cluster was
  stopped afterward.
- `npm --prefix frontend test -- src/pages/curriculum/shared/CurriculumVideoUpload.test.tsx src/pages/curriculum/module-builder/__tests__/moduleStructureDelta.test.ts src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/curriculum/week-builder/__tests__/weekTemplateConcurrency.test.tsx src/pages/curriculum/week-builder/__tests__/weekTemplateData.scope.test.ts src/pages/curriculum/module-builder/__tests__/componentUpload.test.ts src/pages/curriculum/module-builder/__tests__/learnerPreview.test.tsx src/components/feature/__tests__/VideoPlayerFallback.test.tsx --maxWorkers=2`:
  PASS, 67 tests in eight files, including the actual Save handlers and existing
  concurrent-editor behavior. The initial new UI cases needed a selectable rail
  mock and a rich-text stub (the standalone test runner omits the app's auto-import
  plugin); their final run passes without changing application behavior or any
  existing assertion.
- `npm --prefix frontend run lint`: PASS. The initial run caught missing selected
  video dependencies in the Save callback; those dependencies were added before
  the final feature/lint runs.
- `npm --prefix frontend run type-check`: PASS, repeated after the final callback
  dependency edit.
- `npm --prefix frontend run test:teams`: PASS, 146 tests in nine files, required
  because `moduleAuthoringData.ts` was edited.
- `.\backend\.venv\Scripts\python.exe .qa-tmp/run-bunny-tests.py --teams`:
  PASS, 47 isolated backend tests with network blocked. The broader PostgreSQL
  meeting/calendar integration gate documented above remains BLOCKED by missing
  full synthetic Teams fixtures; these tests do not replace it.
- Live Bunny/Teams and production UI: NOT RUN. No remote media, database rows,
  environment settings or production services were changed.

No migration, dependency or environment addition is needed. These follow-up edits
remain local on the existing branch: no commit, push, PR update or deployment was
performed. Review and deployment are still outstanding, subject to the user's
instruction not to publish anything without a further explicit request.

## New-component MP4 picker follow-up on 2026-11-04

The earlier Save-first gate unnecessarily disabled Choose File. New Module/Week
Builder video components now allow selection immediately. A pending-file store
belongs to the open editor, so selecting another component does not lose the
file. Save persists the authoring data before uploading pending MP4s through the
existing endpoint. Returned playback settings are applied to the matching
component and saved snapshot, preserving unrelated settings and newer draft
sources. A failed authoring save never sends the file. A failed upload retains it
for the next Save; Discard, leaving the editor or changing modules clears it.
Canceled uploads cannot restore discarded selections or apply late results.
Existing saved components retain their immediate upload behavior.

Frontend verification (all requests mocked, no live media upload):

- The eight-file feature command in the preceding follow-up, plus
  `src/pages/curriculum/shared/pendingVideoFiles.test.tsx`: PASS, 76 tests in nine
  files. Includes Save-before-upload in both editors, selection persistence across
  inspectors, rejected saves, transfer retries, scope changes and source guards.
- `npm --prefix frontend test -- src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx --maxWorkers=2`:
  PASS, 21 tests, repeated after the final callback dependency edit.
- `npm --prefix frontend run lint`: PASS after explicitly binding the stable
  pending-upload callbacks; the initial lint run reported missing dependencies.
- `npm --prefix frontend run type-check`: PASS, repeated on the final code.
- Teams checks: NOT REQUIRED for this follow-up. No listed Teams file or
  function/type/API contract consumed by one was changed. The preceding
  release-wide integration limitations still apply.
- Backend tests, live Bunny/Teams and production UI: NOT RUN for this frontend
  follow-up. Existing backend source, API, migrations and credentials are unchanged.

These edits also remain local on the current branch. No commit, push, PR update,
deployment or live upload was performed.

## Module Save timeout confirmation on 2026-11-04

Bunny transfer already runs in the background. The reported Module Builder
banner came from the authoring Save timeout; a later read could clear the footer's
failure state while leaving the same error in a separate banner state.

Module Builder now keeps Save errors in one state for both locations. If the
authoring request times out, it makes one fresh structure read, with at most ten
additional seconds spent awaiting confirmation. Only matching authored module,
week and component content, identities, order and scope confirm the save. Derived
totals and revision metadata are excluded from that comparison. There is no
automatic second write. New edits made during confirmation remain unsaved.
An unavailable or different saved copy produces an amber `Save not confirmed`
notice and retains the draft. Later successful refreshes clear the old notice;
when authored values match, the editor also adopts the stored revision metadata
so it does not falsely report unsaved changes.

A confirmed LMS Save finishes while Bunny continues uploading or processing.
`Uploading to Bunny` is still shown until the worker reports completion; it is
never treated as proof of either a completed Bunny copy or the entire module's
saved content. This change does not shorten or bypass the underlying database
write and does not change the existing background worker.

Validation uses synthetic data and mocked requests:

- `npm --prefix frontend test -- src/pages/curriculum/module-builder/__tests__/confirmModuleSave.test.ts src/pages/curriculum/module-builder/__tests__/moduleAutoSave.test.tsx src/pages/curriculum/module-builder/__tests__/moduleLiveSync.test.tsx --maxWorkers=2`:
  PASS, 49 tests in three files. Covers confirmed/ambiguous timeouts, bounded
  readback, no duplicate write, retained later edits, stale-banner recovery,
  Bunny uploading alongside a completed LMS Save, and existing live merges.
  The first run exposed old revision metadata keeping the refreshed editor
  dirty; the final change adopts the stored snapshot only when authored content
  matches. No existing assertion was weakened.
- `npm --prefix frontend run lint`: PASS.
- `npm --prefix frontend run type-check`: PASS.
- Teams baseline and expanded Teams checks: NOT REQUIRED for this follow-up.
  Only Module Builder's page, its private confirmation helper, regression tests
  and this document changed; no listed Teams file or consumed contract changed.
  Earlier release-wide integration limitations remain as recorded above.
- Backend tests and live Bunny/Teams/production checks: NOT RUN. No backend,
  database, environment, service or remote-media operation was performed.

These changes remain local. No commit, push, PR update or deployment was performed.
