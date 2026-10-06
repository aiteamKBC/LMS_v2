from django.core.management.base import BaseCommand, CommandError

from coach_api.dashboard_snapshot_scheduler import coach_emails, refresh_due_snapshots


class Command(BaseCommand):
    help = (
        "Refresh persistent Coach Dashboard summary projections. Serving processes "
        "already do this hourly in the background; use this for an immediate rebuild."
    )

    def add_arguments(self, parser):
        parser.add_argument("--coach", dest="coach_email")
        parser.add_argument(
            "--due", action="store_true",
            help="Only rebuild coaches whose snapshot is older than the hourly interval, "
                 "claiming each one exactly as the background schedule does.",
        )

    def handle(self, *args, **options):
        requested = (options.get("coach_email") or "").strip().lower()
        emails = coach_emails(requested)
        if requested and not emails:
            raise CommandError("No Coach account matches that email.")
        counts = refresh_due_snapshots(emails=emails, force=not options.get("due"))
        self.stdout.write(
            f"Done. refreshed={counts['refreshed']} skipped={counts['skipped']} failed={counts['failed']}"
        )
        if counts["failed"]:
            raise CommandError(
                "Could not refresh the Coach Dashboard snapshot for: " + ", ".join(counts["failedCoaches"])
            )
