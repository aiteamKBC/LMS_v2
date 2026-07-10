"""Add the structured training-plan column to Commercial_users.

One-off, idempotent migration. Adds enrolment."Commercial_users"."Training_plan"
(jsonb, nullable) alongside the existing legacy Modules/Weeks/Components text
columns — those are left in place untouched, just no longer written to by
current code. Apprenticeship learners need no DDL change: they reuse the
pre-existing (and previously unused) "Learning_plan" column on Enrolment_Users.

Run it once:

    python manage.py apply_training_plan_column          # apply
    python manage.py apply_training_plan_column --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"


class Command(BaseCommand):
    help = "Add Commercial_users.Training_plan (jsonb) for structured training-plan storage."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after column list without committing (rolls back).",
        )

    def _columns(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name='Commercial_users' "
            "ORDER BY ordinal_position"
        )
        return cur.fetchall()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                self.stdout.write("\n===== BEFORE =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                cur.execute(
                    'ALTER TABLE enrolment."Commercial_users" '
                    'ADD COLUMN IF NOT EXISTS "Training_plan" jsonb'
                )

                self.stdout.write("\n===== AFTER =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
