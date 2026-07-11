"""Add the quiz-attempt storage column to Active_users.

One-off, idempotent migration. Adds "Learner"."Active_users"."Weekly_Quizzes"
(json, nullable) alongside the existing KSBs/Training_plan JSON columns, for
storing each learner's quiz attempts (quiz name, grade, related week/module,
time taken, submitted timestamp).

Run it once:

    python manage.py apply_weekly_quizzes_column          # apply
    python manage.py apply_weekly_quizzes_column --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"


class Command(BaseCommand):
    help = 'Add "Learner"."Active_users"."Weekly_Quizzes" (json) for quiz-attempt storage.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after column list without committing (rolls back).",
        )

    def _columns(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='Learner' AND table_name='Active_users' "
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
                    'ALTER TABLE "Learner"."Active_users" '
                    'ADD COLUMN IF NOT EXISTS "Weekly_Quizzes" json'
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
