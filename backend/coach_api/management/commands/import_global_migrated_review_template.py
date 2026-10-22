"""Import a reviewed Aptem definition without copying answers or enabling it."""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from coach_api.migrated_template_sync import lock_template_family
from coach_api.migrated_template_views import template_name
from coach_api.migrated_templates import FAMILIES, historical_candidate, template_definition_counts
from coach_api.models import MigratedReviewTemplate


class Command(BaseCommand):
    help = "Preview or create a Global template from a Completed Aptem review (inactive, metadata only)."

    def add_arguments(self, parser):
        parser.add_argument("--source-review-id", type=int, required=True)
        parser.add_argument("--review-family", choices=FAMILIES, required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument("--create", action="store_true", help="Create an inactive Global template; default is dry-run")

    def handle(self, *args, **options):
        if options["source_review_id"] <= 0:
            raise CommandError("A positive internal review ID is required.")
        try:
            name = template_name(options["name"])
            definition, metadata = historical_candidate(options["source_review_id"], options["review_family"])
        except (TypeError, ValueError) as exc:
            raise CommandError(str(exc)) from exc
        counts = template_definition_counts(definition)
        self.stdout.write(f"Global {options['review_family']}: {counts['sections']} sections, {counts['questions']} questions.")
        if not options["create"]:
            self.stdout.write("Dry-run: no template created.")
            return
        with transaction.atomic():
            lock_template_family(options["review_family"])
            existing = list(MigratedReviewTemplate.objects.select_for_update().filter(
                scope="GLOBAL", programme_key="", review_family=options["review_family"]))
            for template in existing:
                if (template.source_metadata.get("sourceReviewId") == options["source_review_id"]
                        and template.definition_json == definition):
                    self.stdout.write(f"Global template ID {template.pk} already exists; unchanged.")
                    return
            if existing:
                raise CommandError("A Global template already exists. Manage its versions in Review Templates.")
            template = MigratedReviewTemplate.objects.create(
                scope="GLOBAL", programme_key="", review_family=options["review_family"],
                name=name, definition_json=definition, source_metadata=metadata, is_active=False,
            )
        self.stdout.write(f"Created inactive Global template ID {template.pk}. Review and enable it in Review Templates.")
