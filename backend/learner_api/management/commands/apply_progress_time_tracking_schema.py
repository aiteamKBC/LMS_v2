"""Apply/check the audit provenance columns used by learner time tracking."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


TABLE = '"Learner"."learner_progress_entries"'
COLUMNS = (
    ("time_tracking_source", "text not null default ''"),
    ("time_tracking_calculation", "text not null default ''"),
    ("time_tracking_session_ref", "text not null default ''"),
    ("claimed_seconds", "integer"),
    ("server_session_seconds", "integer"),
    ("verified_seconds", "integer"),
)
INDEX_NAME = "learner_progress_tracking_session_uq"


class Command(BaseCommand):
    help = "Apply or check learner progress time-tracking provenance columns."

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        connection = connections["enrolment"]
        if connection.vendor != "postgresql":
            raise CommandError("This schema command requires PostgreSQL.")

        with connection.cursor() as cursor:
            cursor.execute("select to_regclass(%s)", ['"Learner".learner_progress_entries'])
            if cursor.fetchone()[0] is None:
                raise CommandError("Learner.learner_progress_entries does not exist.")
            cursor.execute(
                "select column_name from information_schema.columns "
                "where table_schema = 'Learner' and table_name = 'learner_progress_entries'"
            )
            existing = {row[0] for row in cursor.fetchall()}
            cursor.execute("select to_regclass(%s)", [f'"Learner".{INDEX_NAME}'])
            index_exists = cursor.fetchone()[0] is not None

        missing = [name for name, _definition in COLUMNS if name not in existing]
        if options["check"]:
            problems = []
            if missing:
                problems.append("missing columns: " + ", ".join(missing))
            if not index_exists:
                problems.append(f"missing replay-protection index: {INDEX_NAME}")
            if problems:
                raise CommandError("; ".join(problems))
            self.stdout.write(self.style.SUCCESS("Time-tracking columns and replay protection are present."))
            return

        with transaction.atomic(using="enrolment"):
            with connection.cursor() as cursor:
                for name, definition in COLUMNS:
                    cursor.execute(f"alter table {TABLE} add column if not exists {name} {definition}")
                cursor.execute(
                    f"create unique index if not exists {INDEX_NAME} on {TABLE} "
                    "(time_tracking_session_ref) where time_tracking_session_ref <> ''"
                )
            if options["dry_run"]:
                transaction.set_rollback(True, using="enrolment")

        action = "Dry run verified" if options["dry_run"] else "Applied"
        self.stdout.write(self.style.SUCCESS(f"{action} time-tracking columns and replay protection."))
