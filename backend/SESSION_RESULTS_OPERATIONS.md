# Session recordings, transcripts and attendance

## Delivery status

Implementation is local; it has not been deployed. No database writes or migrations were executed by the agent. The Azure container `session-recordings` **was created and its private access verified**, as explicitly authorized. No real recording, transcript or attendance file was transferred during validation.

Activation requires the existing owner-provisioned tables and deployment/restart of the updated application. The web serving process now starts a background scheduler on its first HTTP request. Mocked tests do not verify Microsoft permissions, real SQL execution, Azure upload/playback, or production readiness.

## What users see

- Admin: Module Builder and Module Workspace expose **Sessions & Recordings**. The Teams meeting dialog has the same entry. The module index is small; one opened session loads its saved recording, transcript and attendance. Attendance exports as CSV; transcript exports as TXT.
- Admin: **Preview as learner** opens the module, or the selected component, with the learner content renderer. Quiz answers/reflections stay local. Join and learner progress/submission actions are disabled. This is a material preview, not impersonation of a particular learner's grades, attempts or access window. SCORM previews run in a sandbox; packages requiring an LMS runtime may need a separate compatible preview.
- Learner: the original live-session component closes Join at the session end and shows a native embedded video player plus transcript when the archive is ready. It returns only that learner's attendance. The learner API checks identity and module assignment before delivering files.

## Attendance rules

1. More than **180 seconds** of verified Teams presence gives 1; 180 seconds or less gives 0 after a completed report.
2. Reconnects add time. Overlapping devices/repeated intervals count once. Duration-only evidence uses the largest duration when overlaps cannot be resolved.
3. Clicking Join records the exact occurrence and the authenticated learner. It extends that occurrence's expected roster when the learner was assigned the module after invitations were sent. A click never proves presence. Identity comes from verified email, never a display-name guess.
4. A missing/incomplete report stays pending. Unidentified participants prevent an unsupported absence for unmatched learners. Admin sees **Identity needs review**; no automatic name matching is attempted.
5. An approved excuse stays absent until its linked coach catch-up is marked completed. Watching a recording or booking the catch-up does not set presence. The existing absence/report key ties the learner and occurrence together. The original Teams rows remain unchanged; the register records recovery separately, and re-sync preserves it.

## Azure layout

```text
session-recordings/                        (private container)
  <module-name>_<module-id>-<hash>/
    <group-name>_<group-id>-<hash>/
      session-01_<occurrence-id>-<hash>/
        recording-<artifact-id>.mp4
        transcript-<artifact-id>.vtt
        transcript-<artifact-id>.txt
        attendance.csv
        teams-attendance-original.json
```

Folders are virtual prefixes and appear when a file is first saved. Existing saved artifact paths are reused. Each separate recording segment gets its own MP4. There is no public container or blob ACL. Playback redirects to a read-only SAS for one blob; recording URLs last four hours to support a long lesson and seeking. Ordinary document URLs keep their existing default lifetime.

The worker streams downloads to a temporary disk file and uploads in 4 MiB blocks with concurrency 2. Ready artifacts are skipped. An upload completed before a worker crash is reused. Failure remains visible and retries use backoff. GET requests never download from Graph or start imports.

## Owner-run database setup

Run these files **manually in Neon SQL Editor**, against the application's intended database, before exposing the new UI:

1. [session_results_archive.sql](sql/session_results_archive.sql): adds `curriculum.session_result_archive`, `curriculum.session_result_jobs` and a lookup index on existing Join launches. No historical attendance is recalculated.
2. [session_attendance_reporting.sql](sql/session_attendance_reporting.sql): prerequisites formerly handled by runtime schema repair. Adds missing reporting metadata/indexes, fills missing metadata only, replaces the verified attendance view, and removes the obsolete trigger targeting the old Absence table. Existing attendance statuses are not rewritten by this script. Review that trigger prerequisite for this deployment.
3. If not already applied, the existing [attendance_absence_recovery.sql](sql/attendance_absence_recovery.sql) supplies `recovery_method` and `catchup_event_key` on coach absence reports.

Each new SQL file contains a read-only verification query. Additional preflight:

```sql
SELECT to_regclass('curriculum.live_sessions') AS series,
       to_regclass('curriculum.live_session_occurrences') AS occurrences,
       to_regclass('curriculum.live_session_attendance') AS attendance,
       to_regclass('curriculum.live_session_artifacts') AS artifacts,
       to_regclass('curriculum.live_session_join_launches') AS launches,
       to_regclass('curriculum.session_result_archive') AS archive,
       to_regclass('curriculum.session_result_jobs') AS jobs,
       to_regclass('"Learner".learner_attendance_details') AS learner_register,
       to_regclass('"Coach".coach_absence_report') AS excuses,
       to_regclass('"Coach".coach_calendar_event') AS catchups;

SELECT column_name, data_type
FROM information_schema.columns
WHERE (table_schema='curriculum' AND table_name='session_result_jobs')
   OR (table_schema='Coach' AND table_name='coach_absence_report'
       AND column_name IN ('attendance_id','recovery_method','catchup_event_key'))
ORDER BY table_schema, table_name, ordinal_position;
```

## Background execution

The WSGI and ASGI HTTP entrypoints now start one automatic worker thread per serving process on its first HTTP request, after any server preload/fork. It continues without an open browser, checks the durable queue every 60 seconds after each pass, and calls `process_session_results --scheduled --limit 10`. Existing completed-series checks are limited to once per five minutes; Graph may publish attendance and media at different times. No worker is started merely by importing this module or running a management command.

Manual **Sync attendance & files** commits the queue request, then immediately starts a worker scoped to that meeting series. Two manual workers per serving process are allowed; repeated requests are coalesced and overflow stays in the durable queue. Database leases prevent the automatic/manual/external workers from importing the same series concurrently. The HTTP request does not wait for MP4 transfer. Both session views refresh the saved status and display queued, running, failed and complete states. A completed check can have no recording yet; subsequent checks discover delayed files.

Deploy backend and frontend together and restart the web service. The service must remain running and support background threads. No live deployment, `.env` change, job execution, database write or media transfer was performed while implementing this change. No new schema is required. Existing archive/job tables and Graph/private-Azure access remain prerequisites.

For deployments that use only an external scheduler, set `SESSION_RESULTS_AUTOMATIC=false` in the owner-managed runtime environment to disable the in-process periodic loop. Manual dispatch remains available. Otherwise no new environment setting or separate scheduler is required. Do not add a duplicate external schedule just to activate this version.

The optional external scheduler uses the deployment's existing Python environment from `backend/`. The **existing scheduler command uses the same queue and Azure archiver**, while retaining its coach-meeting synchronization:


```text
python manage.py sync_teams_meeting_artifacts --lookback-hours 168 --limit 10 --coach-limit 100
```

Run every five minutes if choosing this external scheduler. The lookback bounds coach discovery; curriculum discovery also retains early runs. A completed curriculum series is not automatically requeued more often than every five minutes. Historical completed attendance reports outside the 48-hour settling window reuse saved details when participant counts agree. Manual Sync requests a fresh report read. Saved recordings are not uploaded again.

Alternatively, a curriculum-only scheduler can use:

```text
python manage.py process_session_results --scheduled --limit 10
```

Choose one curriculum scheduler entry. The latter does not replace any separate coach-meeting scheduler. Both paths use row locks and a worker lease to prevent duplicate concurrent imports. Failed jobs retry up to eight attempts; manual Sync resets an exhausted job. Completing a linked catch-up queues the older session's exports for refresh too.

The Azure account/key already used by evidence storage are reused. The optional `AZURE_SESSION_RECORDINGS_CONTAINER` defaults to `session-recordings`; no new setting is required for that name. Do not disable authentication/CSRF or enable runtime schema bootstrap to work around missing setup.

Read-only job check:

```sql
SELECT state, count(*), min(requested_at) AS oldest_request
FROM curriculum.session_result_jobs GROUP BY state;
SELECT live_session_id, state, attempts, requested_at, started_at, finished_at, last_error
FROM curriculum.session_result_jobs
WHERE state <> 'complete' ORDER BY requested_at LIMIT 50;
SELECT status, count(*) FROM curriculum.session_result_archive GROUP BY status;
```

## Tests and final acceptance

See [SESSION_RESULTS_VALIDATION.md](SESSION_RESULTS_VALIDATION.md) for exact local checks and remaining limits.

An owner-authorized, isolated integration check still needs to confirm: schema and register writes; an actual test meeting with >180 seconds, <=180 seconds and a non-attendee; Join-to-occurrence matching; the private MP4 playing and seeking; TXT/CSV exports; a repeat sync without duplicate artifacts; one learner denied another learner's file; approved excuse remaining 0; and coach-confirmed catch-up changing it to 1 without deleting the original absence evidence.

Microsoft API references used for the importer: [recording content](https://learn.microsoft.com/en-us/graph/api/callrecording-get?view=graph-rest-1.0), [attendance records](https://learn.microsoft.com/en-us/graph/api/attendancerecord-list?view=graph-rest-1.0). These are separate from live permission validation.
