"""Re-apply the stored meeting policy to Teams meetings that already exist.

A meeting only gets its recording, transcription, lobby and presenter options
when the LMS patches the onlineMeeting behind its calendar event, and until that
patch lands the meeting sits at the tenant defaults: nothing records, nothing is
transcribed, everyone presents. Every meeting created before that patch existed
-- or created while the organizer had no application access policy, so the patch
was refused -- is still sitting at those defaults, and nothing short of asking
Graph again will move it.

Run this after granting OnlineMeetings.ReadWrite.All and an application access
policy to the organizers, and it brings the existing series up to what the LMS
already believes they are. Sessions that were recreated on their own event carry
their own online meeting, and those are patched too.

    python manage.py reapply_teams_meeting_options --dry-run
    python manage.py reapply_teams_meeting_options --organizer tutor@example.com
"""
from django.core.management.base import BaseCommand, CommandError

from coach_api.views import has_graph_credentials
from curriculum_api.views import (
    LIVE_SESSION_OCCURRENCES_TABLE,
    LIVE_SESSIONS_TABLE,
    apply_teams_meeting_options,
    authoring_fetch_all,
    clean_str,
    ensure_live_session_tracking_tables,
    teams_series_email_list,
)


class Command(BaseCommand):
    help = "Re-apply stored recording, transcription, lobby and presenter options to existing Teams meetings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be patched, and ask Microsoft Graph for nothing.",
        )
        parser.add_argument(
            "--organizer",
            default="",
            help="Only series organized by this email address.",
        )
        parser.add_argument(
            "--live-session-id",
            default="",
            help="Only this one series.",
        )
        parser.add_argument(
            "--include-superseded",
            action="store_true",
            help="Also patch series the wizard has already replaced.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not has_graph_credentials():
            raise CommandError("Microsoft Graph credentials are not configured.")
        ensure_live_session_tracking_tables()

        filters = []
        params = []
        if not options["include_superseded"]:
            filters.append("status = %s")
            params.append("active")
        if options["organizer"]:
            filters.append("lower(organizer_email) = %s")
            params.append(options["organizer"].strip().lower())
        if options["live_session_id"]:
            filters.append("id = %s")
            params.append(options["live_session_id"].strip())
        series_rows = authoring_fetch_all(
            LIVE_SESSIONS_TABLE,
            " and ".join(filters) if filters else "",
            params,
            "updated_at desc",
        )
        if not series_rows:
            self.stdout.write("No live-session series matched.")
            return

        applied = skipped = failed = 0
        for series in series_rows:
            live_session_id = clean_str(series.get("id"))
            organizer = clean_str(series.get("organizer_email"))
            join_url = clean_str(series.get("join_url"))
            recording = clean_str(series.get("recording")).lower() or "none"
            lobby = clean_str(series.get("lobby_bypass")).lower() or "invited"
            language = clean_str(series.get("spoken_language")) or "en-GB"
            attendees = teams_series_email_list(series.get("attendees"))
            presenters = teams_series_email_list(series.get("presenters"))
            co_organizers = teams_series_email_list(series.get("co_organizers"))
            if not organizer or not (join_url or clean_str(series.get("online_meeting_id"))):
                self.stdout.write(f"{live_session_id}: no organizer or Teams link -- skipped")
                skipped += 1
                continue

            # The series' own meeting, then any session that runs on a meeting of
            # its own: Graph holds the options per meeting, not per series.
            targets = [(clean_str(series.get("online_meeting_id")), join_url, "series")]
            for occurrence in authoring_fetch_all(
                LIVE_SESSION_OCCURRENCES_TABLE,
                "live_session_id = %s",
                [live_session_id],
                "session_number asc",
            ):
                own_meeting_id = clean_str(occurrence.get("online_meeting_id"))
                if own_meeting_id and own_meeting_id != clean_str(series.get("online_meeting_id")):
                    targets.append((
                        own_meeting_id,
                        clean_str(occurrence.get("join_url")) or join_url,
                        f"session {occurrence.get('session_number')}",
                    ))

            for meeting_id, meeting_join_url, label in targets:
                if dry_run:
                    self.stdout.write(
                        f"{live_session_id} ({label}): would set recording={recording}, lobby={lobby}, "
                        f"language={language}, presenters={len(presenters)}, "
                        f"co-organizers={len(co_organizers)}, attendees={len(attendees)}"
                    )
                    skipped += 1
                    continue
                ok, _meeting, warnings = apply_teams_meeting_options(
                    organizer,
                    meeting_join_url,
                    recording=recording,
                    lobby_bypass=lobby,
                    spoken_language=language,
                    attendees=attendees,
                    presenters=presenters,
                    co_organizers=co_organizers,
                    online_meeting_id=meeting_id,
                )
                if ok:
                    applied += 1
                    self.stdout.write(self.style.SUCCESS(f"{live_session_id} ({label}): applied"))
                    continue
                failed += 1
                detail = "; ".join(clean_str(warning.get("message")) for warning in warnings)
                self.stdout.write(self.style.WARNING(f"{live_session_id} ({label}): {detail}"))

        self.stdout.write(
            f"\n{len(series_rows)} series examined -- {applied} meetings patched, "
            f"{failed} refused by Graph, {skipped} skipped."
        )
