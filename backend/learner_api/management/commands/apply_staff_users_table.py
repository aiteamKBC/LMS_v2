"""Create enrolment."Staff_users" — the table behind "Create admin".

Learners live in Enrolment_Users / Commercial_users; staff (case owners, admins,
enrolment officers, curriculum and operations team members) had no table at all,
so the Create menu's admin path writes here instead of pushing non-learner rows
into a learner table.

Column shape follows the existing staff-profile tables (curriculum.coaches /
curriculum.tutors): a name/email/phone/status core plus timestamps. `position` is
the field the create form asks for and is constrained to POSITION_CHOICES in
learner_api/constants.py (validated in the API, not by a DB check constraint, so
the list can grow without DDL).

Run it once:

    python manage.py apply_staff_users_table            # apply
    python manage.py apply_staff_users_table --dry-run   # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
TABLE = 'enrolment."Staff_users"'


class Command(BaseCommand):
    help = 'Create enrolment."Staff_users" for admin/staff accounts.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the resulting column list without committing (rolls back).",
        )

    def _columns(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name='Staff_users' "
            "ORDER BY ordinal_position"
        )
        return cur.fetchall()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                existed = bool(self._columns(cur))
                self.stdout.write(
                    f"\n{TABLE} {'already exists — ensuring shape' if existed else 'does not exist — creating'}"
                )

                # Mixed-case quoted names match the other enrolment tables so the
                # unmanaged model's db_column values line up.
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS {TABLE} (
                        id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Username"        text,
                        "Email"           text,
                        "Phone_number"    text,
                        "Type"            text,
                        " Status"         text,
                        "Position"        text,
                        "Title"           text,
                        "Preferred_name"  text,
                        "Gender"          text,
                        "Date_of_birth"   text,
                        "Orgnization"     text,
                        "Case_owner"      text,
                        "Learning_provider" text,
                        "Reference_number"  text,
                        "Invite_to_platform"         boolean,
                        "Allow_access_to_checkpoint" boolean,
                        "Allow_access_to_console"    boolean,
                        "Allow_access_to_classic"    boolean,
                        "Created_at"      timestamptz NOT NULL DEFAULT now(),
                        "Updated_at"      timestamptz NOT NULL DEFAULT now()
                    )
                ''')
                # Re-runnable on a table created by an earlier version of this file.
                for name, sql_type in (
                    ("Position", "text"),
                    ("Title", "text"),
                    ("Preferred_name", "text"),
                    ("Gender", "text"),
                    ("Date_of_birth", "text"),
                    ("Orgnization", "text"),
                    ("Case_owner", "text"),
                    ("Learning_provider", "text"),
                    ("Reference_number", "text"),
                    ("Invite_to_platform", "boolean"),
                    ("Allow_access_to_checkpoint", "boolean"),
                    ("Allow_access_to_console", "boolean"),
                    ("Allow_access_to_classic", "boolean"),
                ):
                    cur.execute(f'ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS "{name}" {sql_type}')

                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_staff_users_email_idx '
                    'ON enrolment."Staff_users" (lower(btrim("Email")))'
                )
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_staff_users_position_idx '
                    'ON enrolment."Staff_users" ("Position")'
                )

                self.stdout.write("\n===== COLUMNS =====")
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
