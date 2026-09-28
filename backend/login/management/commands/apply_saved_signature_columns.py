"""Add the saved-signature columns to enrolment."Staff_users".

Learners (Created_users."Learner_signature") and employers (Employers."Signature")
already have somewhere to keep the signature they reuse; staff did not. See
login.saved_signature.

Idempotent: ADD COLUMN IF NOT EXISTS only.

    python manage.py apply_saved_signature_columns            # apply
    python manage.py apply_saved_signature_columns --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
COLUMNS = [
    ('"Saved_signature"', "text"),
    ('"Saved_signature_name"', "text"),
    ('"Saved_signature_at"', "timestamptz"),
]


class Command(BaseCommand):
    help = 'Add saved-signature columns to enrolment."Staff_users".'

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Show the change without committing.")

    def _columns(self, cur):
        cur.execute(
            "select column_name from information_schema.columns "
            "where table_schema='enrolment' and table_name='Staff_users' and column_name ilike 'saved_signature%%' order by 1"
        )
        return [r[0] for r in cur.fetchall()]

    def handle(self, *args, **options):
        with transaction.atomic(using=CONN):
            cur = connections[CONN].cursor()
            self.stdout.write(f"before: {self._columns(cur)}")
            for name, ddl in COLUMNS:
                cur.execute(f'ALTER TABLE enrolment."Staff_users" ADD COLUMN IF NOT EXISTS {name} {ddl}')
            self.stdout.write(f"after:  {self._columns(cur)}")
            if options["dry_run"]:
                transaction.set_rollback(True, using=CONN)
                self.stdout.write(self.style.WARNING("--dry-run: rolled back."))
            else:
                self.stdout.write(self.style.SUCCESS("Committed."))
