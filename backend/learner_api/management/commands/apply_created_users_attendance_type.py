"""Add enrolment."Created_users"."Attendance_type" — whether a learner's sessions are recorded.

Asked on the create/edit learner form as "Attendance type", one of
"Recorded" / "Not recorded", for both apprenticeship and commercial learners.
Optional: NULL means nobody has said yet, which is what every learner created
before this column existed reads as. Nothing is backfilled — guessing a value
for an existing learner would state a fact nobody recorded.

The allowed values are enforced twice: by the API (validate_choices against
ATTENDANCE_TYPE_CHOICES) and by a CHECK constraint here, so a write that skips
the API still cannot store a third value.

The column must exist before the model maps it: a mapped column is SELECTed by
every query on this table, including the one login runs, so deploy order is
this command first, then the code.

Run it once:

    python manage.py apply_created_users_attendance_type            # apply
    python manage.py apply_created_users_attendance_type --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
TABLE = 'enrolment."Created_users"'
COLUMN = "Attendance_type"
CONSTRAINT = "created_users_attendance_type_check"


class Command(BaseCommand):
    help = 'Add enrolment."Created_users"."Attendance_type" (Recorded / Not recorded).'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan without committing (rolls back).",
        )

    def _column(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name='Created_users' "
            "AND column_name=%s",
            [COLUMN],
        )
        return cur.fetchone()

    def _constraint_exists(self, cur):
        cur.execute(
            "SELECT 1 FROM pg_constraint c "
            "JOIN pg_namespace n ON n.oid = c.connamespace "
            "WHERE n.nspname = 'enrolment' AND c.conname = %s",
            [CONSTRAINT],
        )
        return cur.fetchone() is not None

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                self.stdout.write(f"BEFORE: {self._column(cur) or 'column absent'}")

                cur.execute(f'ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS "{COLUMN}" text')
                if not self._constraint_exists(cur):
                    cur.execute(
                        f'ALTER TABLE {TABLE} ADD CONSTRAINT "{CONSTRAINT}" '
                        f'CHECK ("{COLUMN}" IS NULL OR "{COLUMN}" IN (\'Recorded\', \'Not recorded\'))'
                    )

                self.stdout.write(f"AFTER:  {self._column(cur)}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("Committed."))
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
