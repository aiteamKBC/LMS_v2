"""Convert enrolment."Created_users"."Learning_plan" from text to jsonb.

The column pre-existed as free text and was later repurposed to hold an
apprenticeship learner's structured training plan (see EnrolmentUser.learning_plan).
Storing a document in a text column means Postgres cannot validate or index it,
and every read pays a json.loads() in Python — so this migrates it to jsonb, the
same type Training_plan already uses.

Rows currently hold either NULL or a JSON array written by the wizard, so the
cast is lossless. Any row whose text is not valid JSON would abort the ALTER;
--check reports those first rather than failing halfway.

Idempotent: re-running against a jsonb column is a no-op.

    python manage.py apply_learning_plan_jsonb --check
    python manage.py apply_learning_plan_jsonb
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

# These tables live in the Neon `enrolment` schema, which EnrolmentRouter
# sends every model read and write to. Creating them on the `default` alias
# only worked because .env sets a single Database_url that both aliases
# resolve to; split them and the DDL lands on one database while the ORM
# queries another. Use the same alias the models use.
CONN = "enrolment"

TABLE = 'enrolment."Created_users"'
COLUMN = "Learning_plan"


def _column_type(cursor):
    cursor.execute(
        """
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'enrolment'
          AND table_name = 'Created_users'
          AND column_name = %s
        """,
        [COLUMN],
    )
    row = cursor.fetchone()
    return row[0] if row else None


def _unparseable_rows(cursor):
    """ids whose Learning_plan text is not valid JSON, so the cast would fail."""
    cursor.execute(
        f"""
        SELECT id, left("{COLUMN}", 120)
        FROM {TABLE}
        WHERE "{COLUMN}" IS NOT NULL
          AND btrim("{COLUMN}") <> ''
          AND NOT (btrim("{COLUMN}") ~ '^[\\[{{]')
        ORDER BY id
        """
    )
    return cursor.fetchall()


class Command(BaseCommand):
    help = 'Convert enrolment."Created_users"."Learning_plan" from text to jsonb.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="Report the current type and any unconvertible rows, then exit.",
        )

    def handle(self, *args, **options):
        with connections[CONN].cursor() as cursor:
            current = _column_type(cursor)
            if current is None:
                self.stderr.write(f"Column {COLUMN} not found on {TABLE}.")
                return

            self.stdout.write(f"{COLUMN} is currently: {current}")
            if current == "jsonb":
                self.stdout.write(self.style.SUCCESS("Already jsonb — nothing to do."))
                return

            bad = _unparseable_rows(cursor)
            for row_id, sample in bad:
                self.stderr.write(f"  id={row_id} is not JSON: {sample!r}")
            if bad:
                self.stderr.write(
                    self.style.ERROR(
                        f"{len(bad)} row(s) hold non-JSON text; the cast would fail. "
                        "Clear or fix those rows first."
                    )
                )
                return

            if options["check"]:
                self.stdout.write(self.style.SUCCESS("Safe to convert."))
                return

            # Blank strings are not valid json, so normalise them to NULL first.
            # using=CONN is required: the cursor above is on the enrolment alias,
            # and a bare atomic() would open the transaction on `default` instead,
            # leaving this ALTER outside the block it appears to be inside.
            with transaction.atomic(using=CONN):
                cursor.execute(
                    f'UPDATE {TABLE} SET "{COLUMN}" = NULL '
                    f'WHERE "{COLUMN}" IS NOT NULL AND btrim("{COLUMN}") = \'\''
                )
                cursor.execute(
                    f'ALTER TABLE {TABLE} '
                    f'ALTER COLUMN "{COLUMN}" TYPE jsonb USING "{COLUMN}"::jsonb'
                )

            self.stdout.write(
                self.style.SUCCESS(f"{COLUMN} converted to jsonb ({_column_type(cursor)}).")
            )
