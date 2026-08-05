"""Add "Coach".coach_calendar_event.graph_organizer_email.

The mailbox a Graph event is created on becomes its organizer, and Graph never
emails the organizer -- the meeting just appears on their calendar. Learner-booked
sessions therefore organize from the *learner's* mailbox so the coach / enrolment
officer actually receives an invite email, which means the organizer is no longer
always owner_email. Reading, patching and deleting the event must target the
mailbox it was created on, so it is recorded per row.

Idempotent: safe to re-run.

    python manage.py apply_graph_organizer_column            # apply
    python manage.py apply_graph_organizer_column --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
SCHEMA = "Coach"
TABLE = "coach_calendar_event"
COLUMN = "graph_organizer_email"

ADD_COLUMN_SQL = (
    f'ALTER TABLE "{SCHEMA}"."{TABLE}" '
    f'ADD COLUMN IF NOT EXISTS {COLUMN} varchar(255) NOT NULL DEFAULT \'\''
)

# Existing rows were all organized by the owner, which was the only behaviour
# before this change. Only fill rows that actually have a Graph event.
BACKFILL_SQL = (
    f'UPDATE "{SCHEMA}"."{TABLE}" SET {COLUMN} = owner_email '
    f"WHERE {COLUMN} = '' AND COALESCE(graph_event_id, '') <> ''"
)


class Command(BaseCommand):
    help = f'Add and backfill "{SCHEMA}"."{TABLE}".{COLUMN}.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after column list without committing (rolls back).",
        )

    def _columns(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
            [SCHEMA, TABLE],
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

                cur.execute(ADD_COLUMN_SQL)
                cur.execute(BACKFILL_SQL)
                self.stdout.write(f"\nbackfilled {cur.rowcount} existing row(s) to owner_email")

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
