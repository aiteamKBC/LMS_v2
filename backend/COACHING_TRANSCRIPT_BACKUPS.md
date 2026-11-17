# Coaching transcript backups

Coaching videos stay in Microsoft/SharePoint. Lecture videos and their caption
tracks keep the existing Bunny workflow. PDF preview/download stays in the LMS.

`backup_coaching_transcripts` copies **only existing saved coaching WebVTT** to
private S3 through the application's storage adapter. It does not contact
Microsoft or Bunny, download videos, generate transcripts, send mail, update
attendance or change meeting/session associations. It retains both saved VTT and
readable database text so Quality and PDF readers remain available during a
storage outage. Existing archive pointers are left unchanged.

## Run after review, merge and deployment

Use a one-off task from the deployed session-worker task definition with its
existing database/storage settings and task role. No new credentials or schema
migration is needed. Confirm the deployed commit contains the command and
verify the database, endpoint and private bucket independently before applying.

Inspect is the default. It performs a SELECT and reports aggregate counts/bytes;
it does not contact storage or write anything:

```sh
python manage.py backup_coaching_transcripts --limit 100
```

After reviewing inspect, substitute the verified environment names:

```sh
python manage.py backup_coaching_transcripts --limit 100 --apply \
  --expected-database DATABASE --expected-endpoint ENDPOINT \
  --expected-bucket PRIVATE_BUCKET
```

`--event-key` can be repeated for a narrower repair. Limits are 1–500. Each part
must be valid saved WebVTT of at most 2 MiB. Selection excludes recordings,
empty VTT and rows with existing archive pointers. This is a backup of saved
transcripts, not a scan for transcripts absent from Microsoft or the database.

Each row is locked independently. The command writes an immutable name, reads
the full object back, compares SHA-256, then publishes the archive pointer in
the same row transaction. It never clears source text or deletes/overwrites
storage objects. A failed transaction can leave an unreferenced immutable
object; a retry verifies and reuses it. A failure never publishes a success
pointer. Reports contain counts and exception class names, without private
links, learner information or transcript contents.

For each apply batch require `failedVerification=0`, `busy=0`, and
`verifiedBackups=selectedTranscriptParts`. Repeat bounded batches until inspect
reports zero. A nonzero exit is incomplete, even if some rows succeeded. Retry
busy rows after the current worker finishes. Investigate oversized/invalid
sources or storage failures without clearing database text. This command does
not install a scheduler; future saved transcripts can use the same reviewed
command.

Finally verify the private files using the task role, and check an authorized
coaching transcript PDF/Quality view and SharePoint video playback in the app.
