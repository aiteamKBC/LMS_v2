"""Patch existing Coach/MCM/Progress Review Teams meetings to direct entry.

New coach-calendar meetings use ``COACH_MEETING_LOBBY_BYPASS`` automatically.
This command is the one-time bridge for meetings created before that policy
changed.  It only PATCHes the Teams online meeting; it does not recreate the
calendar event or resend invitations.

    python manage.py reapply_coach_teams_lobby --dry-run
    python manage.py reapply_coach_teams_lobby --owner coach@example.com
"""

from django.core.management.base import BaseCommand, CommandError

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    apply_teams_meeting_options,
    clean_text,
    graph_organizer_mailbox,
    has_graph_credentials,
)


class Command(BaseCommand):
    help = "Allow everyone to join existing Coach, MCM and Progress Review Teams meetings without lobby admission."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List matching meetings without calling Microsoft Graph.")
        parser.add_argument("--owner", default="", help="Only meetings organized by this coach email.")
        parser.add_argument("--event-type", default="", help="Only this CoachCalendarEvent type (for example mcr or progress-review).")
        parser.add_argument("--event-key", default="", help="Only this event key.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        if not dry_run and not has_graph_credentials():
            raise CommandError("Microsoft Graph credentials are not configured.")

        queryset = CoachCalendarEvent.objects.exclude(meeting_link="").exclude(
            status=CoachCalendarEvent.STATUS_CANCELLED,
        )
        if options["owner"]:
            queryset = queryset.filter(owner_email__iexact=options["owner"].strip())
        if options["event_type"]:
            queryset = queryset.filter(event_type=options["event_type"].strip())
        if options["event_key"]:
            queryset = queryset.filter(event_key=options["event_key"].strip())

        applied = skipped = failed = 0
        for record in queryset.order_by("id").iterator():
            link = clean_text(record.meeting_link)
            organizer = graph_organizer_mailbox(record, {})
            label = f"{record.event_key} ({record.event_type})"
            if not link or not organizer:
                self.stdout.write(f"{label}: no organizer or Teams link -- skipped")
                skipped += 1
                continue
            if dry_run:
                self.stdout.write(f"{label}: would set lobby=everyone")
                skipped += 1
                continue

            ok, _meeting, warnings = apply_teams_meeting_options(
                organizer,
                link,
                recording=None,
                spoken_language=None,
                lobby_bypass="everyone",
            )
            if ok:
                applied += 1
                self.stdout.write(self.style.SUCCESS(f"{label}: applied"))
            else:
                failed += 1
                detail = "; ".join(clean_text(item.get("message")) for item in warnings)
                self.stdout.write(self.style.WARNING(f"{label}: {detail or 'Microsoft Graph refused the update.'}"))

        self.stdout.write(
            f"\n{applied + failed + skipped} coach meetings examined -- "
            f"{applied} patched, {failed} refused by Graph, {skipped} skipped."
        )
