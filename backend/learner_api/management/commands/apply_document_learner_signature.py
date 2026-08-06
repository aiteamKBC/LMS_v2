"""Add learner sign-off columns to enrolment."Enrolment_Documents".

The table already records an employer signature (Employer_signature/_name/_at),
because the first documents needing sign-off were employer-facing. The
Apprenticeship Agreement is signed by BOTH the apprentice and the employer, so
the learner needs the same three columns rather than sharing the employer's.

"Signed" stays as the summary flag the documents list reads, and now means
"every party this document needs has signed".

Idempotent — uses ADD COLUMN IF NOT EXISTS, so it is safe to re-run.

    python manage.py apply_document_learner_signature --check
    python manage.py apply_document_learner_signature
"""
from django.core.management.base import BaseCommand
from django.db import connection

TABLE = 'enrolment."Enrolment_Documents"'
COLUMNS = (
    ("Learner_signature", "text"),
    ("Learner_signed_name", "text"),
    ("Learner_signed_at", "timestamp with time zone"),
)


def _existing(cursor):
    cursor.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'enrolment' AND table_name = 'Enrolment_Documents'
        """
    )
    return {r[0] for r in cursor.fetchall()}


class Command(BaseCommand):
    help = "Add learner signature columns to enrolment.Enrolment_Documents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check", action="store_true", help="Report what is missing, then exit."
        )

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            present = _existing(cursor)
            if not present:
                self.stderr.write(
                    f"{TABLE} not found — generate a document first so the table exists."
                )
                return

            missing = [(name, ddl) for name, ddl in COLUMNS if name not in present]
            if not missing:
                self.stdout.write(self.style.SUCCESS("All learner signature columns present."))
                return

            for name, _ in missing:
                self.stdout.write(f"  missing: {name}")

            if options["check"]:
                self.stdout.write(self.style.SUCCESS(f"{len(missing)} column(s) would be added."))
                return

            for name, ddl in missing:
                cursor.execute(f'ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS "{name}" {ddl}')

            self.stdout.write(
                self.style.SUCCESS(f"Added {len(missing)} column(s) to Enrolment_Documents.")
            )
