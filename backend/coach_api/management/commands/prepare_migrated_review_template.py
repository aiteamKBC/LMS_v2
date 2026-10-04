"""Preview one Aptem form; create an inactive candidate only with --create."""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from coach_api.migrated_reviews import candidate_definition, programme_key, review_family
from coach_api.models import MigratedReviewTemplate


class Command(BaseCommand):
    help = "Preview or create an inactive migrated Review template from one selected Aptem review."

    def add_arguments(self, parser):
        parser.add_argument("--source-review-id", type=int, required=True)
        parser.add_argument("--programme-key", required=True, help="Exact id:<programme_id> or name:<display name> key")
        parser.add_argument("--review-family", choices=["MCM", "PR", "PR_SKILLS_RADAR"], required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument("--create", action="store_true", help="Persist an inactive candidate; default is dry-run")
        parser.add_argument("--preview", action="store_true", help="Print the sanitized candidate definition")

    def handle(self, *args, **options):
        source_id = options["source_review_id"]
        requested_key = options["programme_key"].strip()
        if not requested_key.startswith(("id:", "name:")):
            raise CommandError("Programme key must use the explicit id: or name: prefix.")
        with connections["default"].cursor() as cursor:
            cursor.execute(
                '''SELECT r.review_type, r.review_data, l.programme_id, l.programme
                   FROM "Learner".reviews r
                   JOIN "Learner".learners l ON l.id = r.learner_id
                   WHERE r.id = %s''', [source_id],
            )
            row = cursor.fetchone()
        if row is None:
            raise CommandError("Selected source review was not found with a learner profile.")
        source_type, source_data, programme_id, programme_name = row
        if review_family(source_type) != options["review_family"]:
            raise CommandError("Selected source review is not in the requested review family.")
        actual_key = programme_key(programme_id, programme_name)
        if requested_key != actual_key:
            raise CommandError("Selected source review does not have the requested programme identity.")
        if isinstance(source_data, str):
            source_data = json.loads(source_data)
        try:
            definition = candidate_definition(source_data)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(f"Programme: {actual_key}; family: {options['review_family']}; source review row: {source_id}")
        self.stdout.write(f"Captured sections: {len(definition['sections'])}; mode: {'create inactive' if options['create'] else 'dry-run'}")
        if options["preview"]:
            self.stdout.write(json.dumps(definition, ensure_ascii=False, indent=2))
        if not options["create"]:
            return
        with transaction.atomic():
            template = MigratedReviewTemplate.objects.create(
                programme_key=actual_key,
                review_family=options["review_family"],
                name=options["name"],
                definition_json=definition,
                is_active=False,
            )
        self.stdout.write(f"Created inactive migrated template ID {template.pk}. An admin must approve activation.")
