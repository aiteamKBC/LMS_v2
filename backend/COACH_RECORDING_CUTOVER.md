# Coaches recordings: new meetings only

The agreed boundary is the **meeting start**, from **26 November 2026, 00:00 in
`settings.TIME_ZONE`** (the LMS business zone). An older meeting stays on its
existing Microsoft/SharePoint route even if its recording appears after that
date. No historical coach migration is scheduled.

The separate **Coaches** library is `821960`. Configure its server-only settings:

```
BUNNY_COACH_STREAM_LIBRARY_ID
BUNNY_COACH_STREAM_API_KEY
BUNNY_COACH_STREAM_TOKEN_KEY
```

Keep values out of Git, logs and PRs. The library must have one standard H.264
resolution, **720p**, premium encoding and paid transcription disabled, and
original-file retention disabled on Bunny. Microsoft retains the original under
its own retention policy. The worker accepts one lower rendition if the input
cannot provide 720p; it refuses to publish multiple or higher renditions.

Enable embed view token authentication, disable direct play, block requests
without a referrer and allow only `lms.kentbusinesscollege.org` and
`dev-lms.kentbusinesscollege.net`. Do not enable uploads while these settings
are unverified. No live upload test has been performed merely by adding keys.

## One existing worker and journal

`process_session_results --scheduled` invokes the coaching phase on the existing
AWS session worker. There is no second recording service. The existing coaching
calendar/evidence queue discovers meetings in stable 28-day windows, including
new coaches without a Quality page visit. Its existing claim budgets still apply.
Every current coach gets one persistent collection with a stable identity marker;
a coach added later is discovered on a subsequent worker pass.

`BUNNY_COACH_RECORDING_UPLOADS_ENABLED` defaults off. Enable it on the worker
and coach API only after reviewed code is merged/deployed, settings are checked
and any other uploader covering these new originals is stopped and drained.

New coach recordings reuse `curriculum_video_import` with `coach_recording`
targets; the material worker excludes those targets. The existing session worker
claims them through the same lease mechanism. No schema migration is introduced.

The worker verifies the fresh calendar occurrence and Graph recording identity,
then resolves a unique Microsoft drive item using its size, recording-time
window and bounded first/last byte comparisons. Its drive/item/version identity
is checked again before transfer. These probes are not a full-file SHA-256 scan.
Missing permissions, ambiguous files or a changed version block transfer rather
than guessing a source or falling back to a full AWS media download/upload.

Bunny fetches the transient Microsoft download URL. The URL is never saved or
logged, and the Microsoft bearer token is never sent to Bunny. A durable source
claim makes Graph aliases of the same file share one GUID within the authorized
occurrence. A committed fetch intent prevents a lost response or stale search
index from starting another video. Failed/uncertain GUIDs remain for repair;
elapsed time alone never permits creating a replacement.

For tutor LiveSessions, `BUNNY_RECORDING_DIRECT_FETCH_ENABLED=true` selects this
same transport after the separately coordinated LiveSessions owner switch.
Existing module/week/component bindings remain authoritative. Unreconciled peer
uploads block a second original; title, date or part number alone cannot adopt one.

## Playback and transcripts

Ready coach media appears in its existing authorized Quality meeting. The
`format=playback` response supplies a short-lived signed iframe after the existing
role/owner/occurrence checks. It never returns management keys. Historical MP4
playback/downloads retain their existing Microsoft path.

The worker checks signed playback and rejection of an invalid token before
publication. It retains verified Bunny media if Microsoft later stops listing
the original. Microsoft captions are attached to the same video and retained as
verified text in the LMS journal for the existing transcript/PDF reader. Late or
failed captions retry hourly without replacing a ready video. No AI transcript
generation is requested. A stale discovery completion cannot overwrite a newer
video publication.

## Validation and activation

From `backend`:

```
python -m curriculum_api.run_video_import_tests
python -m coach_api.run_recording_tests
python -m unittest curriculum_api.test_session_cloud_archive_no_db
```

From `frontend`:

```
npm run type-check
npm exec -- vitest run src/pages/coaching-recordings src/api/coachingRecordings.test.ts src/api/coachingQualityReviews.test.ts src/api/coachingCompletion.test.ts --maxWorkers=2
```

These are isolated, mocked regressions. The separate
`curriculum_api.test_recording_direct_postgres` suite exercises actual PostgreSQL
locks, simultaneous aliases and collection provisioning. Run it only through a
runner that verifies the actual local host, port and data directory and creates
a fresh disposable `lms_gate_coaches_*` database; a database name alone does not
prove isolation. Automated doubles do not prove live provider acceptance.
After deployment, validate
one authorized new coach recording and one tutor occurrence through their saved
identities and actual authorized UI, including captions and token rejection.
Confirm each has one import/GUID, the correct collection and correct Quality or
week/component scope before wider activation. Keep the old uploader drained.

Rollback disables new upload flags, drains claimed transfers and rolls back to
the previous reviewed image/build. Retain journal rows, original links, ready
GUIDs and transcript history; do not delete/recreate media to clear an error.
