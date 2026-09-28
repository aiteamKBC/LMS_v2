from django.core.management.base import BaseCommand, CommandError
from django.db.models.functions import Lower, Trim

from coach_api.dashboard_service import CoachDashboardService
from learner_api.constants import ACCESS_COACH
from learner_api.models import StaffUser
from login.identity import accesses_for_staff


class Command(BaseCommand):
    help = "Refresh persistent Coach Dashboard summary projections."

    def add_arguments(self, parser):
        parser.add_argument("--coach", dest="coach_email")

    def handle(self, *args, **options):
        requested = (options.get("coach_email") or "").strip().lower()
        queryset = StaffUser.objects.annotate(email_key=Lower(Trim("email")))
        if requested:
            queryset = queryset.filter(email_key=requested)
        emails = sorted({
            row.email_key
            for row in queryset
            if row.email_key and ACCESS_COACH in accesses_for_staff(row)
        })
        if requested and not emails:
            raise CommandError("No Coach account matches that email.")
        for email in emails:
            CoachDashboardService(email).refresh()
            self.stdout.write(self.style.SUCCESS(f"Refreshed Coach Dashboard snapshot for {email}"))
