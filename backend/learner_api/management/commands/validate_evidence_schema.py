"""Validate learner evidence schema without creating or altering database objects."""
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from learner_api.evidence_tables import (
    EvidenceSchemaValidationError,
    validate_evidence_schema,
)


class Command(BaseCommand):
    help = (
        'Read-only validation of "Learner".evidence_files and '
        '"Learner"."Evidence" for deployment readiness.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--database",
            default="enrolment",
            help="Django database alias to validate (default: enrolment).",
        )

    def handle(self, *args, **options):
        alias = options["database"]
        try:
            report = validate_evidence_schema(using=alias)
        except EvidenceSchemaValidationError as exc:
            details = "\n".join(f"- {issue}" for issue in exc.report.issues)
            raise CommandError(f"Evidence schema validation failed:\n{details}") from None
        except DatabaseError as exc:
            raise CommandError(
                "Evidence schema validation could not query the selected database "
                f"({exc.__class__.__name__})."
            ) from None

        self.stdout.write(
            self.style.SUCCESS(
                "Evidence schema verified read-only: "
                f"{report.relation_count} relations, "
                f"{report.required_column_count} required columns, "
                f"{report.required_index_count} required indexes."
            )
        )
