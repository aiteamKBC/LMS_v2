"""Update active migrated MCM and Progress Review templates; dry-run by default."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from coach_api.migrated_next_review_booking import FAMILIES, with_next_review_booking
from coach_api.migrated_template_impact import answer_conflicts
from coach_api.migrated_template_sync import lock_template_family
from coach_api.migrated_templates import validate_managed_definition
from coach_api.models import MigratedReviewTemplate


class Command(BaseCommand):
    help = "Add next-meeting confirmation to active migrated PR forms and learner access to MCM; dry-run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--template-id", type=int, help="Limit the update to one active migrated template.")
        parser.add_argument("--expected-host", help="Required with --apply; must match the configured database host.")
        parser.add_argument("--expected-database", help="Required with --apply; must match the configured database name.")

    def handle(self, *args, **options):
        connection = connections["default"]
        database = connection.settings_dict
        host, name = database.get("HOST") or "", database.get("NAME") or ""
        self.stdout.write(f"Target database: {name} on {host or 'local connection'}")
        if options["apply"] and (not options["expected_host"] or not options["expected_database"]
                                  or options["expected_host"] != host or options["expected_database"] != name):
            raise CommandError("Pass the exact configured host and database name before applying changes.")

        query = MigratedReviewTemplate.objects.filter(is_active=True, review_family__in=FAMILIES)
        if options["template_id"]:
            query = query.filter(pk=options["template_id"])
        targets = list(query.order_by("review_family", "pk").values_list("pk", "review_family"))
        if options["template_id"] and not targets:
            raise CommandError("The selected template is not an active migrated MCM or Progress Review template.")

        with transaction.atomic():
            for template_id, family in targets:
                if options["apply"]:
                    lock_template_family(family)
                    template = MigratedReviewTemplate.objects.select_for_update().get(pk=template_id)
                    if not template.is_active or template.review_family != family:
                        raise CommandError(f"Template {template_id} changed while the backfill was running.")
                else:
                    template = MigratedReviewTemplate.objects.get(pk=template_id)
                try:
                    action, updated = with_next_review_booking(template.definition_json, family)
                    if action != "already_present":
                        validate_managed_definition(updated, family=family)
                except ValueError as exc:
                    raise CommandError(f"Template {template_id}: {exc}") from exc
                self.stdout.write(f"Template {template_id} ({family}): {action}")
                if options["apply"] and action != "already_present":
                    template.definition_json = updated
                    conflict = answer_conflicts(template)
                    if conflict:
                        raise CommandError(f"Template {template_id}: {conflict['detail']}")
                    template.save(update_fields=["definition_json", "updated_at"])
        if not options["apply"]:
            self.stdout.write("DRY RUN: no templates changed.")
