"""Create enrolment.eligibility_form, where the public apprenticeship
application (/apprenticeship_application) saves each submission.

Idempotent: CREATE TABLE IF NOT EXISTS only; an existing table and its rows are
never altered. Run once per environment before the form goes live -- the
public endpoint never creates the table itself.

    python manage.py apply_eligibility_form_table            # apply
    python manage.py apply_eligibility_form_table --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

from enrolment_api.eligibility_form import CONN, TABLE, ensure_table


class Command(BaseCommand):
    help = "Create enrolment.eligibility_form for the public apprenticeship application."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Roll back instead of committing.")

    def handle(self, *args, **options):
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cursor:
                ensure_table(cursor)
                cursor.execute(f"SELECT count(*) FROM enrolment.{TABLE}")
                self.stdout.write(f"  enrolment.{TABLE} — {cursor.fetchone()[0]} application(s)")
            if options["dry_run"]:
                transaction.set_rollback(True, using=CONN)
                self.stdout.write(self.style.WARNING("--dry-run: rolled back, nothing committed."))
            else:
                self.stdout.write(self.style.SUCCESS("Committed."))
