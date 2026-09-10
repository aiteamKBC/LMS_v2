"""Synchronise AI in Marketing into the normal authored learner journey."""

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.ai_marketing_curriculum import build_projection, sync_projection


class Command(BaseCommand):
    help = "Project the AI audit table into the authored curriculum."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write changes. Default is dry-run.")

    def handle(self, *args, **options):
        rows, components, total_otjh = build_projection()
        if not rows:
            raise CommandError("programme_audit.ai_in_marketing is missing or empty.")
        self.stdout.write(
            f"AI in Marketing: {len(rows)} audit rows -> {len(components)} components, {total_otjh}h"
        )
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("DRY RUN: pass --apply to write the curriculum projection."))
            return

        result = sync_projection()
        self.stdout.write(self.style.SUCCESS(
            f'COMMITTED: {result["components"]} components.'
        ))

