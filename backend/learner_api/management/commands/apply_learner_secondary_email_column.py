"""Add the optional contact-only secondary email column to learner profiles.

The primary ``learners.email`` column remains the unique login/identity address.
This command intentionally adds no uniqueness constraint and does not copy or
change any account email in ``enrolment.Created_users``.

    python manage.py apply_learner_secondary_email_column
    python manage.py apply_learner_secondary_email_column --dry-run
"""

from django.core.management.base import BaseCommand
from django.db import connections, transaction


CONN = "enrolment"
SCHEMA = "Learner"
TABLE = "learners"
COLUMN = "secondary_email"


class Command(BaseCommand):
    help = 'Add the optional contact-only secondary_email column to "Learner"."learners".'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Check the change and roll the transaction back.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        connection = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ WRITE")
                    cursor.execute(
                        'ALTER TABLE "Learner"."learners" '
                        'ADD COLUMN IF NOT EXISTS "secondary_email" varchar(320)'
                    )
                    cursor.execute(
                        "SELECT is_nullable, character_maximum_length "
                        "FROM information_schema.columns "
                        "WHERE table_schema=%s AND table_name=%s AND column_name=%s",
                        [SCHEMA, TABLE, COLUMN],
                    )
                    column = cursor.fetchone()
                    if column != ("YES", 320):
                        raise RuntimeError(
                            "secondary_email must be a nullable varchar(320); "
                            f"found {column!r}"
                        )

                if dry_run:
                    transaction.set_rollback(True, using=CONN)
                    self.stdout.write(self.style.WARNING("--dry-run: rolled back."))
                else:
                    self.stdout.write(self.style.SUCCESS("secondary_email column is present."))
        except Exception as exc:  # noqa: BLE001 - make a failed DDL change visible
            self.stderr.write(self.style.ERROR(f"Schema change failed (rolled back): {exc}"))
            raise
