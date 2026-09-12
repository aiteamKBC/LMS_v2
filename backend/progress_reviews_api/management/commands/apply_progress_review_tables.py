"""Create the Progress Review PPTX tables at deploy time.

    python manage.py apply_progress_review_tables --check
    python manage.py apply_progress_review_tables

Shares its DDL with tables.ensure_progress_review_tables so the deploy step and
the request-path safety net can never disagree (see enrolment_api's
apply_enrolment_documents_table for why relying on the safety net alone is
risky: a table that is auto-created mid-request never gets a column added after
its first release, because the ALTER commands that add such columns typically
bail out when the table does not exist yet).
"""
from django.core.management.base import BaseCommand
from django.db import connections

from ... import tables

CONN = "enrolment"
TABLES = (
    "progress_review_runs",
    "progress_review_source_snapshots",
    "progress_review_pptx_files",
)


def _existing_tables(cursor):
    cursor.execute(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'Learner' AND table_name = ANY(%s)
        """,
        [list(TABLES)],
    )
    return {r[0] for r in cursor.fetchall()}


class Command(BaseCommand):
    help = 'Create "Learner".progress_review_* tables for Progress Review PPTX generation.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--check", action="store_true", help="Report what is missing, then exit."
        )

    def handle(self, *args, **options):
        conn = connections[CONN]

        with conn.cursor() as cursor:
            before = _existing_tables(cursor)
        missing = sorted(set(TABLES) - before)
        if missing:
            for name in missing:
                self.stdout.write(f'  missing: "Learner".{name}')
        else:
            self.stdout.write("All expected tables present.")

        if options["check"]:
            return

        tables._READY = False
        tables.ensure_progress_review_tables()
        tables._READY = False

        with conn.cursor() as cursor:
            after = _existing_tables(cursor)
        created = sorted(after - before)
        self.stdout.write(
            self.style.SUCCESS(
                "Progress Review tables are ready." + (f" Created: {created}." if created else "")
            )
        )
