# Live session attachments

Staff can add a session PDF, slide deck, document, spreadsheet, image or text file
(maximum 50 MB) below the recording in the existing session results component.
Learners can download files only through the existing owned-session authorization
gate. A cross-module recording-only link does not grant attachment access.
An explicitly booked additional meeting retains access to its own attachments,
limited to the authorized occurrence(s).

Files reuse `live_session_artifacts` and `session_result_archive`; no migration,
new learning activity, required completion, attendance edit or hours entry is
introduced. SHA256 identities are scoped to the occurrence. Retrying a file,
including after a lost storage response, reuses the artifact and object path.
The first saved filename is retained. Failed attachments do not invalidate the
recording or block the existing attendance feedback delivery.

## Storage

With no Bunny Storage configuration, the existing private LMS session archive
is used through `config.blob_storage` (Azure or S3 according to the runtime).
The verified AWS environment currently uses its existing S3 archive. Downloads
receive a five-minute, single-object read URL with attachment disposition.
No public bucket/container is made.

To use Bunny **Storage**, provision a private storage zone separately and supply
these values through the existing runtime secret mechanism to curriculum-api,
learner-api and session-worker (and night-api when used):

- `BUNNY_SESSION_ATTACHMENTS_ZONE`: the storage zone name.
- `BUNNY_SESSION_ATTACHMENTS_KEY`: its Storage AccessKey, never a Stream key.
- `BUNNY_SESSION_ATTACHMENTS_HOST`: its region endpoint; default `storage.bunnycdn.com`.

Bunny objects are downloaded through the authorized LMS endpoint, without a
public Pull Zone or a browser-visible AccessKey. Existing archive files remain on
their saved storage. Partial Bunny configuration fails visibly; it does not
silently move files to a different provider. Do not remove a zone's credentials
while saved attachments still reference it.

## Automatic collection from Microsoft

Automatic chat collection defaults off. Set `SESSION_ATTACHMENTS_AUTO_IMPORT_ENABLED=true`
only on the session worker after Microsoft administrator consent for chat reads
(`Chat.Read.All`, or meeting-specific `ChatMessage.Read.Chat` with the app installed)
and file reads is verified. The current shared tenant application has file access
but lacks chat-read consent as checked on 26 November 2026. No permission grants
are made by this feature. Set the same switch on curriculum-api for the staff UI
to show its configured state.

The existing scheduled worker processes attachments independently after recording
and feedback processing. It reads only tracked meeting chats, including shifted
occurrence meetings. Sender IDs must match the stored organizer, presenters or
co-organizers; learner uploads, cards, folders and non-SharePoint URLs are excluded.
Only sessions in the last 14 days (or starting within two hours) are discovered.
A message must match exactly one occurrence window, from two hours before its
scheduled start to four hours after its scheduled end. Ambiguous/outside-window
files require a staff upload to the intended session; the worker never guesses.
Chat pagination is bounded and incomplete pages are not published. File links are
resolved afresh; expiring Microsoft download URLs are never saved or logged.

No existing files, Microsoft meetings, schedules, invitations or historical
learner evidence are rewritten by activation. Older session files can be added
manually to their exact session.

## Checks

Run `python -m curriculum_api.run_session_attachment_tests` from backend for
mocked I/O checks against an explicitly isolated in-memory configuration.
The existing verified PostgreSQL runner is extended by
`run_session_attachment_postgres_tests`, requiring an empty owned loopback
`lms_gate_*` database and the matching cluster directory. It also runs the
expanded Teams suites. The PR workflow runs these checks, recording regressions,
the attachment UI tests, lint, type checking and a build. The existing Teams
workflow supplies the frontend Teams baseline. Attachment checks also gate the
main deployment; releases predating the feature report them as not required.
Live Microsoft imports and Bunny Storage remain separate activation checks.
