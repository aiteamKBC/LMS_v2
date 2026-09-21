"""Copy Teams meeting recordings out of Microsoft Graph into Azure Blob.

Graph holds the only copy of a recording until this runs. It is not a storage
guarantee: outages, a dropped application access policy, and Microsoft's own
retention all end with the recording gone. Run this on a schedule (hourly is
plenty) so every recording Graph has handed over is archived shortly after the
meeting ends.

Recordings are large, so this is deliberately a background command and never
part of a web request: one pass can take minutes.
"""
from django.core.management.base import BaseCommand
from django.db import close_old_connections, router

from coach_api.models import CoachCalendarEvent
from coach_api.recording_archive import (
    archive_configured,
    archive_recording,
    blob_columns_ready,
    download_recording_from_graph,
    pending_recordings,
    recording_is_archived,
    recordings_container,
)
from coach_api.recording_archive import (
    archive_live_session_recording,
    archive_live_session_transcript,
    archive_transcript_vtt,
    download_transcript_from_graph,
    live_session_blob_columns_ready,
    pending_live_session_recordings,
    pending_live_session_transcripts,
    transcript_blob_columns_ready,
)


class Command(BaseCommand):
    help = "Archive Teams meeting recordings from Microsoft Graph into Azure Blob Storage."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=25,
            help="Maximum recordings to archive in one pass. Default: 25.",
        )
        parser.add_argument(
            "--event-key",
            dest="event_key",
            default="",
            help="Archive only the recordings belonging to one event_key.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be archived without downloading or uploading anything.",
        )

    def handle(self, *args, **options):
        from coach_api.views import coach_meeting_graph_target

        database = router.db_for_write(CoachCalendarEvent) or "default"

        if not archive_configured():
            self.stderr.write(
                "Azure storage is not configured (AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY). "
                "Recordings stay in Graph only."
            )
            return
        if not blob_columns_ready(database):
            self.stderr.write(
                "The blob_* columns on Coach.coach_meeting_artifacts are missing. "
                "Apply the column migration before archiving."
            )
            return

        limit = max(1, int(options["limit"]))
        wanted_key = (options.get("event_key") or "").strip()
        dry_run = bool(options.get("dry_run"))

        rows = pending_recordings(database, limit=limit)
        if wanted_key:
            rows = [row for row in rows if row.get("event_key") == wanted_key]

        if not rows:
            # Transcripts are offloaded independently of recordings, so this
            # must not return: a run with no pending recordings still has
            # transcript work to do.
            self.stdout.write("No recordings pending: every known recording is already in a container.")
            if not dry_run:
                self._archive_transcripts(database)
                self._archive_live_sessions(database)
            return

        self.stdout.write(f"Archiving up to {len(rows)} recording(s) into '{recordings_container()}'.")

        archived = skipped = failed = 0
        for row in rows:
            close_old_connections()
            event_key = row.get("event_key") or ""
            artifact_id = row.get("graph_artifact_id") or ""
            # Graph recording ids share a long common prefix (the base64 meeting
            # thread), so a leading slice makes distinct recordings look identical.
            # The tail is the part that differs.
            label = f"{event_key} / ...{artifact_id[-18:]}"

            if recording_is_archived(event_key, artifact_id, database):
                skipped += 1
                self.stdout.write(f"  skip    {label} (already archived)")
                continue
            if dry_run:
                self.stdout.write(f"  would   {label}")
                continue

            record = (
                CoachCalendarEvent.objects.filter(event_key=event_key).first()
                if event_key
                else None
            )
            if record is None:
                failed += 1
                self.stderr.write(f"  fail    {label}: no calendar event row")
                continue

            base, error_payload = coach_meeting_graph_target(record)
            if not base or error_payload:
                failed += 1
                detail = (error_payload or {}).get("detail", "Graph could not resolve the meeting.")
                self.stderr.write(f"  fail    {label}: {detail}")
                continue

            content, content_type, error = download_recording_from_graph(base, artifact_id)
            if error or not content:
                failed += 1
                self.stderr.write(f"  fail    {label}: {error or 'empty recording'}")
                continue

            result = archive_recording(event_key, artifact_id, content, content_type, database)
            if result["archived"]:
                archived += 1
                size_mb = len(content) / (1024 * 1024)
                self.stdout.write(f"  ok      {label} -> {result['blob_name']} ({size_mb:.1f} MB)")
            else:
                failed += 1
                self.stderr.write(f"  fail    {label}: {result['error']}")

        self.stdout.write(
            self.style.SUCCESS(f"Done. archived={archived} skipped={skipped} failed={failed}")
        )
        if not dry_run:
            self._archive_transcripts(database)
            self._archive_live_sessions(database)

    def _archive_live_sessions(self, database):
        """Archive curriculum live-session recordings.

        Their artifacts live in their own table keyed by occurrence, but the
        exposure is identical: without this they exist only inside Graph.
        """
        from curriculum_api.views import live_session_recording_graph_base

        if not live_session_blob_columns_ready(database):
            return
        rows = pending_live_session_recordings(database, limit=25)
        if not rows:
            # Transcripts are archived independently, so a pass with no pending
            # recordings still has transcript work to do.
            self._archive_live_session_transcripts(database)
            return

        archived = failed = 0
        for row in rows:
            close_old_connections()
            occurrence_id = row["occurrence_id"]
            artifact_id = row["graph_artifact_id"]
            base, error = live_session_recording_graph_base(occurrence_id)
            if not base:
                failed += 1
                self.stderr.write(f"  live fail {occurrence_id}: {error}")
                continue
            content, content_type, download_error = download_recording_from_graph(base, artifact_id)
            if download_error or not content:
                failed += 1
                self.stderr.write(f"  live fail {occurrence_id}: {download_error or 'empty recording'}")
                continue
            result = archive_live_session_recording(
                occurrence_id, artifact_id, content, content_type, database
            )
            if result["archived"]:
                archived += 1
                self.stdout.write(
                    f"  live ok   {occurrence_id} -> {result['blob_name']} "
                    f"({len(content) / (1024 * 1024):.1f} MB)"
                )
            else:
                failed += 1
                self.stderr.write(f"  live fail {occurrence_id}: {result['error']}")

        self.stdout.write(self.style.SUCCESS(f"Live sessions archived={archived} failed={failed}"))
        self._archive_live_session_transcripts(database)

    def _archive_live_session_transcripts(self, database):
        """Same split as coach transcripts: VTT to blob, readable text to the row."""
        from curriculum_api.views import live_session_recording_graph_base

        if not live_session_blob_columns_ready(database):
            return
        rows = pending_live_session_transcripts(database, limit=50)
        if not rows:
            return

        archived = failed = 0
        for row in rows:
            close_old_connections()
            occurrence_id = row["occurrence_id"]
            artifact_id = row["graph_artifact_id"]
            base, error = live_session_recording_graph_base(occurrence_id)
            if not base:
                failed += 1
                self.stderr.write(f"  live transcript fail {occurrence_id}: {error}")
                continue
            vtt, download_error = download_transcript_from_graph(base, artifact_id)
            if download_error or not vtt:
                failed += 1
                self.stderr.write(
                    f"  live transcript fail {occurrence_id}: {download_error or 'empty transcript'}"
                )
                continue
            result = archive_live_session_transcript(occurrence_id, artifact_id, vtt, database)
            if result["archived"]:
                archived += 1
            else:
                failed += 1
                self.stderr.write(f"  live transcript fail {occurrence_id}: {result['error']}")

        self.stdout.write(
            self.style.SUCCESS(f"Live session transcripts archived={archived} failed={failed}")
        )

    def _archive_transcripts(self, database):
        """Offload WebVTT bodies that are still sitting in the table.

        transcript_text stays put so SQL search keeps working; only the verbose
        cue file moves, which is what actually grows the table.
        """
        from django.db import connections

        if not transcript_blob_columns_ready(database):
            return
        with connections[database].cursor() as cursor:
            cursor.execute(
                """
                select event_key, graph_artifact_id, transcript_vtt
                from "Coach".coach_meeting_artifacts
                where artifact_type = 'transcript'
                  and coalesce(transcript_vtt, '') <> ''
                  and coalesce(transcript_blob_name, '') = ''
                limit 200
                """
            )
            rows = cursor.fetchall()
        if not rows:
            return
        moved = failed = 0
        for event_key, artifact_id, vtt in rows:
            result = archive_transcript_vtt(event_key, artifact_id, vtt, database)
            if result["archived"]:
                moved += 1
            else:
                failed += 1
                self.stderr.write(f"  transcript fail {event_key}: {result['error']}")
        self.stdout.write(self.style.SUCCESS(f"Transcripts offloaded={moved} failed={failed}"))
