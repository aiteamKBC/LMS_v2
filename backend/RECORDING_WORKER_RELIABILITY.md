# Recording worker reliability

The existing `process_session_results --scheduled` worker discovers recordings
and drains saved imports. A saved tutor import retries independently of the
meeting-series discovery attempt limit. Coaching discovery drains the same retry
mechanism for coach imports. No additional service or schema migration is needed.

## Retry guarantees and limits

- Retry state is durable in `CurriculumVideoImport.scope.recording_retry`.
  Failures wait 1, 2, 4, 8, 16, 32 minutes, then at most one hour. There is no
  maximum failure count. Encoding polls wait one minute.
- The queue selects due work before applying its batch limit. Active leases
  remain untouched; an expired process lease can be recovered after a restart.
- Every retry retains its import identity, original Microsoft source, occurrence,
  destination and any confirmed Bunny GUID. A lost fetch response is reconciled
  through the existing import marker; it never authorizes another fetch POST.
- Publication failure is a visible failed import with its own retry. It does not
  stop the next recording in the batch or fabricate a ready Quality entry.
- Wrong ownership, changed source/version, ambiguous existing Bunny videos and
  cancelled occurrences remain blocked. Retrying cannot make an unsafe identity
  safe; those cases require source/configuration repair or a scoped review.
- A confirmed failed Bunny GUID is retained for repair. Automatic retries do not
  create a replacement original, delete a video, or bypass protected playback.

## Microsoft source resolution

The organiser's OneDrive Recordings folder remains the first verified source.
For a channel meeting, the fallback reads the meeting's exact channel thread,
the organiser's joined teams and the channel's `filesFolder`. It scans that
channel folder and its Recordings child, with complete bounded pagination.

Both routes require one MP4 matching the recording's time window and byte size,
matching first/last byte probes, and a DriveItem identity/version recheck. Only a
fresh preauthenticated SharePoint URL is handed to Bunny. No application bearer
token is handed to Bunny, no media file is buffered on AWS, and signed URLs are
not persisted or logged. Permission failures and incomplete scans remain errors.

## Completed coaching calls and later calendar changes

An original completed call can retain its original occurrence after the same
calendar event is rescheduled only when a successful saved original event
snapshot, current Teams meeting identity and fresh Microsoft recording identity
all agree. The new calendar date is not changed. A previously cancelled or
unverified occurrence does not gain this exception.

A recording part outside the scheduled interval needs a fresh complete Graph
recording list, an unchanged target recording and a timed part linked by the
same physical call/correlation identity. A recurring meeting/join URL alone is
not sufficient. Published retained calls are shown at their original occurrence
in their authorised coach's Quality calendar; hours and attendance are untouched.

## Release acceptance

Run the isolated recording/video suites and the existing frontend Teams baseline.
Use the verified disposable PostgreSQL runner for the expanded Teams suites and
`curriculum_api.test_recording_retry_postgres`, including simultaneous claims.
Routine tests mock Microsoft/Bunny and must not use an application database.

After required PR review and merged-main CI/CD, verify the actual deployed image
and process one scoped failed recording at a time. Check its saved GUID, encoding,
protected playback and correct Quality/component projection. Then verify a repeat
pass creates no extra provider object. Mocked tests and source byte probes alone
do not establish a successful deployed transfer.

## Shared originals (owner approved on 2026-11-27)

The same verified Microsoft file now has one durable `recording_media` claim
across coach occurrences and the protected recording libraries. Its key is the
DriveItem identity; a changed version is held for review rather than copied again.
Existing proved originals/in-flight uploads win. A known tutor import is preferred
before a new upload; otherwise a coach original stays in its coach collection.

Every occurrence keeps its own import, meeting identity, access boundary,
transcript and Quality/component projection. A reference must match both its
immutable source receipt and its own saved scope. It reuses the original's actual
library/GUID after protected-player verification. It never moves the original,
retags it for another occurrence, uploads another copy, or overwrites its caption
track. Coach originals retain one resolution up to 720p; an existing shared tutor
lecture keeps its tutor resolutions. New coach collections are still provisioned
normally, including coaches whose shared lectures reference another collection.

The claim protects concurrent workers, retries and late discovery in another
calendar. Existing historical ready originals are not deleted, rewritten or
merged. This does not claim that historical duplicate provider objects have been
removed. Legacy Materials/FreeCourse libraries and their security are unchanged.
