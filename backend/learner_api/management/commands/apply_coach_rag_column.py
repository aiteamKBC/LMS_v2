"""Add coach_rag columns to the LMS learner mirror tables.

Idempotent DDL for:
  - "Learner"."Active_users"."coach_rag"
  - "Learner"."Unactive_users"."coach_rag"

The column stores a coach-set RAG value for the caseload UI. Allowed values are
restricted at the database level to green / amber / red (case-insensitive),
while null remains allowed for learners that have not been tagged yet.
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
TABLES = (
    ("Active_users", "active_users_coach_rag_check"),
    ("Unactive_users", "unactive_users_coach_rag_check"),
)


class Command(BaseCommand):
    help = 'Add "coach_rag" to "Learner"."Active_users" and "Learner"."Unactive_users".'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan without committing changes.",
        )

    def _columns(self, cur, table_name):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='Learner' AND table_name=%s "
            "ORDER BY ordinal_position",
            [table_name],
        )
        return cur.fetchall()

    def _constraint_exists(self, cur, constraint_name):
        cur.execute(
            "SELECT 1 FROM pg_constraint WHERE conname = %s",
            [constraint_name],
        )
        return cur.fetchone() is not None

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                for table_name, constraint_name in TABLES:
                    self.stdout.write(f"\n===== {table_name} BEFORE =====")
                    for col in self._columns(cur, table_name):
                        self.stdout.write(f"  {col}")

                    cur.execute(
                        f'ALTER TABLE "Learner"."{table_name}" '
                        'ADD COLUMN IF NOT EXISTS "coach_rag" text'
                    )

                    if not self._constraint_exists(cur, constraint_name):
                        cur.execute(
                            f'ALTER TABLE "Learner"."{table_name}" '
                            f'ADD CONSTRAINT "{constraint_name}" '
                            'CHECK ("coach_rag" IS NULL OR lower(trim("coach_rag")) IN (\'green\', \'amber\', \'red\'))'
                        )

                    self.stdout.write(f"\n===== {table_name} AFTER =====")
                    for col in self._columns(cur, table_name):
                        self.stdout.write(f"  {col}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
