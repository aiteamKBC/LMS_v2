"""Enable a reviewed Global PSP, with editable learner questions by default."""
from copy import deepcopy
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from coach_api.migrated_reviews import all_fields
from coach_api.migrated_template_sync import lock_template_family
from coach_api.migrated_templates import validate_managed_definition
from coach_api.models import MigratedReviewTemplate


class Command(BaseCommand):
    help = "Enable a Global PSP template; preserve explicit per-question permissions. Dry-run unless --apply."

    def add_arguments(self, parser):
        parser.add_argument("--template-id", required=True, type=int)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        with transaction.atomic():
            lock_template_family("PSP")
            template = MigratedReviewTemplate.objects.select_for_update().filter(
                pk=options["template_id"], scope="GLOBAL", programme_key="", review_family="PSP").first()
            if template is None:
                raise CommandError("The selected Global Personal Support Plan template was not found.")
            if MigratedReviewTemplate.objects.filter(review_family="PSP", is_active=True).exclude(pk=template.pk).exists():
                raise CommandError("Another Personal Support Plan template is active. Manage its version in Review Templates.")
            definition = deepcopy(template.definition_json)
            assigned = 0
            for field in all_fields(definition):
                if field.get("aptemType") != 11 and "respondentRoles" not in field:
                    field["respondentRoles"] = ["participant"]
                    assigned += 1
            validate_managed_definition(definition, family="PSP")
            changed = assigned > 0 or not template.is_active
            if options["apply"] and changed:
                template.definition_json = definition
                template.is_active = True
                template.save(update_fields=["definition_json", "is_active", "updated_at"])
                template.refresh_from_db()
                if not template.is_active or template.definition_json != definition:
                    raise CommandError("Personal Support Plan activation could not be verified.")
            mode = "Applied" if options["apply"] else "Dry-run"
            self.stdout.write(f"{mode}: Global PSP {template.pk}; {assigned} questions gain learner permissions; "
                              f"{'activation verified' if options['apply'] else 'no changes saved'}.")
