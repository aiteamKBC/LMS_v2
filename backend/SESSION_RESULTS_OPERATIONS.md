# Session recordings, transcripts and attendance

## Delivery status

Changes in this working tree are not automatically deployed to the public backend. The private Azure container `session-recordings` was provisioned and verified. Scoped live recoveries on 13–14 October 2026 imported missing Teams recordings into the production database and container; check the current job and archive rows below for completion rather than relying on this dated note.

Activation requires the existing owner-provisioned tables and deployment/restart of the updated application. The web serving process starts a background scheduler on its first HTTP request. Mocked tests do not verify Microsoft permissions, real SQL execution, Azure upload/playback, or production readiness.

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

When the verified OneDrive source is unavailable, the worker streams Graph downloads to a temporary disk file and uploads in 1 MiB blocks with concurrency 8 and a 45-second read timeout per request. Transient Graph download and Azure upload failures get up to three attempts. Azure retries reuse the temporary file without downloading it again from Graph. Ready artifacts are skipped. An upload completed before a worker crash is reused. Failure remains visible with a safe phase and exception class, and later jobs retry with backoff. GET requests never download from Graph or start imports.

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

The WSGI and ASGI HTTP entrypoints start separate primary and reviewer threads per serving process on its first HTTP request, after any server preload/fork. They continue without an open browser. The normal worker checks the durable queue every 60 seconds after each pass and calls `process_session_results --scheduled --limit 10`. Completed-series checks run at most every five minutes for lectures that ended within 48 hours and daily for older series; Graph may publish attendance and media at different times. The independent reviewer runs every five minutes, even while the primary worker transfers a long recording. It checks new ready Azure copies and one twelfth of older ready copies using HEAD requests; every older copy is checked about hourly while the server stays active. Missing or empty copies are queued into the same leased job table, never transferred by the reviewer. No worker starts merely by importing this module or running a management command.

Automatic discovery includes active sessions with an organiser and either a stored online meeting ID or a Teams join URL. When only the join URL is saved, the sync endpoint attempts to resolve its meeting ID through Graph; a permission or policy failure stays visible as a failed job and is retried.

Manual **Sync attendance & files** commits the queue request, then immediately starts a worker scoped to that meeting series. Two manual workers per serving process are allowed; repeated requests are coalesced and overflow stays in the durable queue. Database leases prevent the automatic/manual/external workers from importing the same series concurrently. The HTTP request does not wait for MP4 transfer. Both session views refresh the saved status and display queued, running, failed and complete states. A completed check can have no recording yet; subsequent checks discover delayed files.

Each worker pass also fills missing Teams occurrence IDs on existing live-session components when exactly one active component and one active occurrence share the module and local date, and their saved join links, confirmed start times and any existing meeting IDs agree. It changes only the three tracking fields, then invalidates curriculum caches. Ambiguous dates, additional meetings, conflicting IDs and unmatched links stay untouched; staff can review them in Sessions & Recordings. The learner projection keeps its date-based fallback until the stored component is repaired. This pass does not create a recording that Microsoft has not published or bypass a failed Graph/Azure transfer.

Deploy backend and frontend together and restart the web service. The service must remain running and support background threads. The 13 October recovery changed the local `.env` and scoped production job/artifact rows and transferred available media; it did not deploy code or update the separately hosted backend environment. No new schema is required. Existing archive/job tables and Graph/private-Azure access remain prerequisites.

For deployments that use only an external scheduler, set `SESSION_RESULTS_AUTOMATIC=false` in the owner-managed runtime environment to disable the in-process periodic loop. Schedule both `process_session_results --scheduled --limit 10` and `review_session_recordings` every five minutes on the server. Manual dispatch remains available. Otherwise no new environment setting or separate scheduler is required. The reviewer runs alongside the existing automatic loop when automatic mode is enabled. A standalone scheduler is preferable when the web host sleeps or does not permit durable background threads; deploy it on the remote server, never on an operator laptop.

The optional external scheduler uses the deployment's existing Python environment from `backend/`. The **existing scheduler command uses the same queue and Azure archiver**, while retaining its coach-meeting synchronization:


```text
python manage.py sync_teams_meeting_artifacts --lookback-hours 168 --limit 10 --coach-limit 100
```

Run every five minutes if choosing this external scheduler. The lookback bounds coach discovery; curriculum discovery also retains early runs. A completed curriculum series is not automatically requeued more often than every five minutes. Historical completed attendance reports outside the 48-hour settling window reuse saved details when participant counts agree. Manual Sync requests a fresh report read. Healthy saved recordings are not uploaded again.

Alternatively, a curriculum-only scheduler can use:

```text
python manage.py process_session_results --scheduled --limit 10
```

Also schedule `python manage.py review_session_recordings` every five minutes with either external curriculum command. Use `python manage.py review_session_recordings --full` for an on-demand check that queues every confirmed missing or empty saved file.

Choose one curriculum scheduler entry. The latter does not replace any separate coach-meeting scheduler. Both paths use row locks and a worker lease to prevent duplicate concurrent imports. During a long transfer, progress updates keep its lease alive; a genuinely stalled lease can be reclaimed after two hours. Failed jobs retry up to eight attempts per cycle. The scheduler starts a new cycle after another session in the series ends, after six hours for other exhausted failures, or after one hour when a known recording still lacks a ready private archive. Manual Sync also resets an exhausted job. Completing a linked catch-up queues the older session's exports for refresh too.

The Azure account/key already used by evidence storage are reused. The optional `AZURE_SESSION_RECORDINGS_CONTAINER` defaults to `session-recordings`; no new setting is required for that name. Do not disable authentication/CSRF or enable runtime schema bootstrap to work around missing setup.

The worker first looks for a unique recording in the organizer's OneDrive `Recordings` folder with a matching creation time, exact size, and matching first and last 64 KiB. When found, Azure copies from its short-lived SharePoint URL and the worker verifies the Azure size and edge bytes before marking the recording ready. The URL is never saved. This requires Microsoft Graph drive read permission; a missing permission, source, or match falls back to the normal Graph transfer. Large fallback downloads use validated 16 MiB Graph byte ranges. A failed range retries from its own start, so an earlier successful range is retained; Azure is marked ready only after every byte has been downloaded and the private upload completes. The fallback needs temporary disk space for the largest single recording. Set `SESSION_RECORDINGS_TEMP_DIR` to an existing writable directory on a disk with enough free space when the system temporary disk is small. A full temporary disk is reported as an archive failure and remains retryable; no partial file is published.

If a failed recording is reassigned to its actual lecture, the next archive attempt derives a path from the corrected occurrence and updates the archive row to that occurrence. A ready recording is never moved automatically; review its existing blob and learner visibility before changing historical placement.

The reviewer never assigns a recording to a lecture. It only checks whether a recording already linked in LMS still has its private Azure file. If a file is missing or empty, it marks that archive row failed and queues its series unless another worker owns it. The normal worker then retrieves the same Teams recording. If a previous Azure copy exists after a crash, the worker verifies its byte count and first/last bytes against Teams before calling it ready. A mismatched copy is preserved and a new immutable repair path is used. Transient Azure HEAD failures do not change a ready row. A recording that Teams never created cannot be recovered by this process.

The worker must use the app-only Teams registration through `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID` and `MICROSOFT_GRAPH_CLIENT_SECRET` in its deployed environment. The token needs `OnlineMeetingArtifact.Read.All`, `OnlineMeetingRecording.Read.All` and `OnlineMeetingTranscript.Read.All` application roles to import attendance, recordings and transcripts; reading the organiser's meeting also needs an applicable Teams application access policy. Check the deployed process's token roles and restart it after changing these settings. The repeated generic `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` declarations in the local `.env` may select a different calendar app. Changing the local `.env` does not configure a separately hosted LMS backend.

After deployment, run `python manage.py check_teams_permissions <live_session_id>` in the backend runtime for an affected series. It makes Graph GET requests only and now reports the three session-result roles separately from meeting management permission. A readable meeting alone does not prove that recordings can be imported. A failed job's `last_error` now identifies the failing result type and Graph HTTP status without saving Graph paths or response bodies. Fix any missing app permission or access policy in Microsoft 365, then use the existing **Sync attendance & files** action for immediate retry or let the scheduler retry; a code deployment alone cannot grant tenant permissions.

Run `python manage.py audit_session_recordings` on the deployed backend to compare active modules' Teams recording lists with the LMS artifact rows and private Azure blob presence. It makes Graph GET and Azure HEAD requests only; it never downloads media, changes data, or prints credentials. It exits with an error if a recording is missing, its archive is not ready, a ready blob is absent or empty, a completed session has no recording, or a saved recording's date needs placement review. Use `--live-session-id <id>` to narrow it to one series and `--json` for a structured report. A clean report proves the backend inventory at the time of the check; separately play one recording in the staff and authorized learner screens to verify delivery and playback.

Interpret the issue codes as follows: `graph_check_failed` means fix Graph access before judging completeness; `not_imported` means Teams has a recording close to a planned lecture that the LMS has not saved, so retry sync after fixing access; `unplanned_recording` means Teams has a recording outside the planned lecture time and without a suitable Join launch, so staff must review it before making it available to learners. `archive_not_ready`, `blob_missing`, `empty_blob`, and `storage_check_failed` mean check Azure and retry; the reviewer automatically queues confirmed missing/empty blobs. `meeting_identity_missing` means the meeting cannot be discovered until its ID/link is repaired. `completed_without_recording` needs confirmation that Teams actually recorded that lecture. `placement_review` is a date mismatch signal for staff review, not permission to move historical evidence automatically. Newly discovered recordings that finished before their linked lecture or are more than 12 hours from a planned start without a Join launch are not automatically assigned to a learner component. Historical links are not moved by this rule.

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
