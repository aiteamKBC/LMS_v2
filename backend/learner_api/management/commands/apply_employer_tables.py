"""Create enrolment."Organisations" and enrolment."Employers".

Two new record types behind the Users page's Create menu:

  * Organisations — the employing companies. Status/name/owner/category, the
    EDRS/ERN and apprenticeship-agreement identifiers, address, working-hours
    sessions, a primary contact, levy/H&S flags, a logo and whether to send
    hours-verification emails.
  * Employers — the *people* at those organisations. Personal details and an
    address, plus the "Employer Group" selection naming the organisations they
    belong to.

The link is deliberately by organisation id, held in a jsonb array on the
employer ("Employer_group_ids") rather than a foreign key: the Employer Group
control is multi-select, and these tables are unmanaged (created here, never by a
Django migration), so a real FK would need DDL coordination for no gain. The
matching names are denormalised alongside in "Employer_group_names" so a list row
can be rendered without a second query.

Working hours are stored as jsonb too — the form's "Add another session" repeats
a {day, start, end} triple, which is a list, not a column.

Run it once:

    python manage.py apply_employer_tables            # apply
    python manage.py apply_employer_tables --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
ORGS = 'enrolment."Organisations"'
EMPLOYERS = 'enrolment."Employers"'


class Command(BaseCommand):
    help = 'Create enrolment."Organisations" and enrolment."Employers".'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the resulting column list without committing (rolls back).",
        )

    def _columns(self, cur, table_name):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name=%s "
            "ORDER BY ordinal_position",
            [table_name],
        )
        return cur.fetchall()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                for table, name in ((ORGS, "Organisations"), (EMPLOYERS, "Employers")):
                    existed = bool(self._columns(cur, name))
                    self.stdout.write(
                        f"\n{table} {'already exists — ensuring shape' if existed else 'does not exist — creating'}"
                    )

                # Mixed-case quoted names match the other enrolment tables so the
                # unmanaged models' db_column values line up.
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS {ORGS} (
                        id                      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Status"                text,
                        "Name"                  text,
                        "Owner"                 text,
                        "Category"              text,
                        "Group_type"            text,
                        "Parent_name"           text,
                        "EDRS_ERN_number"       text,
                        "Apprenticeship_agreement_id" text,
                        "Post_code"             text,
                        "Address_1"             text,
                        "Address_2"             text,
                        "City_Town"             text,
                        "County"                text,
                        "Country"               text,
                        "Working_hours"         jsonb NOT NULL DEFAULT '[]'::jsonb,
                        "Contact_name"          text,
                        "Contact_email"         text,
                        "Contact_telephone"     text,
                        "Contact_role"          text,
                        "Website"               text,
                        "Reference_number"      text,
                        "Levy_payer"            text,
                        "Approx_no_of_employees" integer,
                        "Health_and_safety"     text,
                        "Logo_url"              text,
                        "Send_hours_verification_emails" boolean,
                        "Created_at"            timestamptz NOT NULL DEFAULT now(),
                        "Updated_at"            timestamptz NOT NULL DEFAULT now()
                    )
                ''')

                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS {EMPLOYERS} (
                        id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "First_name"          text,
                        "Surname"             text,
                        "Gender"              text,
                        "Email"               text,
                        "Mobile"              text,
                        "Post_code"           text,
                        "Address_1"           text,
                        "Address_2"           text,
                        "Town_City"           text,
                        "County"              text,
                        "Country"             text,
                        -- Which organisations this person belongs to. Ids are the
                        -- link; names are denormalised so a list row needs no join.
                        "Employer_group_ids"   jsonb NOT NULL DEFAULT '[]'::jsonb,
                        "Employer_group_names" jsonb NOT NULL DEFAULT '[]'::jsonb,
                        "Created_at"          timestamptz NOT NULL DEFAULT now(),
                        "Updated_at"          timestamptz NOT NULL DEFAULT now()
                    )
                ''')

                # Re-runnable on tables created by an earlier version of this file.
                for name, sql_type in (
                    ("Group_type", "text"),
                    ("Parent_name", "text"),
                    ("Working_hours", "jsonb NOT NULL DEFAULT '[]'::jsonb"),
                    ("Logo_url", "text"),
                    ("Approx_no_of_employees", "integer"),
                    ("Send_hours_verification_emails", "boolean"),
                ):
                    cur.execute(f'ALTER TABLE {ORGS} ADD COLUMN IF NOT EXISTS "{name}" {sql_type}')
                for name, sql_type in (
                    ("Employer_group_ids", "jsonb NOT NULL DEFAULT '[]'::jsonb"),
                    ("Employer_group_names", "jsonb NOT NULL DEFAULT '[]'::jsonb"),
                ):
                    cur.execute(f'ALTER TABLE {EMPLOYERS} ADD COLUMN IF NOT EXISTS "{name}" {sql_type}')

                # The organisation picker searches by name; employers are looked
                # up by email like every other person table here.
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_organisations_name_idx '
                    'ON enrolment."Organisations" (lower(btrim("Name")))'
                )
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_organisations_status_idx '
                    'ON enrolment."Organisations" ("Status")'
                )
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_employers_email_idx '
                    'ON enrolment."Employers" (lower(btrim("Email")))'
                )
                # Membership is queried the other way round too ("who is at this
                # organisation?"), which needs a GIN index on the id array.
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_employers_group_ids_idx '
                    'ON enrolment."Employers" USING gin ("Employer_group_ids")'
                )

                for table, name in ((ORGS, "Organisations"), (EMPLOYERS, "Employers")):
                    self.stdout.write(f"\n===== {name} =====")
                    for col in self._columns(cur, name):
                        self.stdout.write(f"  {col}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
