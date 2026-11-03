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
Editing unrelated fields does not backfill old videos.
An explicit import button and module-scoped command handle existing sources.
Unassigned templates need a programme before a collection can be selected.

The agreed scope is storage only. Completion records the Bunny library,
collection, video ID and status in the import journal. It never replaces the
component's `videoUrl`, embed, provider or other settings. Existing learner
playback and progress continue to use their current source. A source changed
during upload is marked superseded, while the stored copy remains on Bunny.
Teams meeting/recording synchronization is not part of this importer.

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
  and can be retried from the video panel. No success is fabricated.
- The trigger function has a fixed search path and only writes the qualified
  event table as its owner. Existing SQL writers do not need new table grants or
  Bunny credentials. Its execution privilege is revoked from PUBLIC.
- Installation does not scan or backfill old videos. Events start at migration
  installation, remain queued while the worker is disabled, and are drained
  after activation. An MP4 supplied through the video upload endpoint continues
  to use its existing file-upload path. A file copied onto disk without a saved
  Curriculum video source is not an observable Curriculum upload.

PostgreSQL documents [trigger transactions](https://www.postgresql.org/docs/current/trigger-definition.html)
and [SKIP LOCKED for concurrent queue consumers](https://www.postgresql.org/docs/current/sql-select.html).

## Supported sources and limits

- MP4 device uploads, up to the existing 300 MB curriculum upload limit.
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
rewrite component sources.

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

The production database was read only for MSP discovery. No application schema,
component source, learner data or production source files were changed. Imports
remain disabled locally. Merge/review, both migrations, worker supervision, request
timeouts suitable for MP4 uploads and the outstanding database
checks remain deployment prerequisites. Secrets and runtime manifests are ignored
and must not be committed.

The live pilot uploads and title updates do not enable automatic imports on the
running LMS. Read-only verification found the import table absent from the
configured application database. After deployment and activation, new/changed
Curriculum video sources enter the import queue (including direct writes captured
by the new database triggers), and the new video file control
uploads MP4 to Bunny. Other LMS attachments and existing videos are outside the
automatic upload scope. Queued/failed/ready states must remain visible; saving a
link does not itself prove that Bunny received its media.
