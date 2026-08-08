"""Create enrolment."Training_Plan_Documents".

The Training Plan is the tripartite document: it sets out how the apprentice,
the employer and the training provider will each support the apprenticeship,
and carries the learning plan (modules, methods, dates and off-the-job hours)
that delivers it. All THREE parties sign it — unlike the Apprenticeship
Agreement (apprentice + employer) or the ILR (learner + provider).

Same shape and reasoning as those two: the content is SNAPSHOT onto the row at
issue, so editing the learning plan afterwards cannot rewrite what three
parties put their names to.

    python manage.py apply_training_plans_table --check
    python manage.py apply_training_plans_table
"""
from django.core.management.base import BaseCommand
from django.db import connections

# These tables live in the Neon `enrolment` schema, which EnrolmentRouter
# sends every model read and write to. Creating them on the `default` alias
# only worked because .env sets a single Database_url that both aliases
# resolve to; split them and the DDL lands on one database while the ORM
# queries another. Use the same alias the models use.
CONN = "enrolment"

TABLE = 'enrolment."Training_Plan_Documents"'

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id                  uuid PRIMARY KEY,

    "Learner_kind"      varchar(32) NOT NULL,
    "Learner_id"        bigint      NOT NULL,

    -- ---- Content, snapshot at issue -----------------------------------
    -- Programme particulars: standard, level, reference, the four dates,
    -- duration and ILR planned hours.
    "Programme"         jsonb,
    -- Employer block: employer, delivery address, job title, working hours,
    -- line manager.
    "Employment"        jsonb,
    -- The learning plan itself: one row per module, with hours.
    "Learning_plan"     jsonb,
    -- Off-the-job summary and End Point Assessment details.
    "Otjh"              jsonb,
    "Epa"               jsonb,
    -- Apprentice and employer contact details (the appendices).
    "Contacts"          jsonb,

    -- ---- Signatories: all three parties -------------------------------
    -- Each signs with a name, a position and a mark (PNG data URL).
    "Apprentice_signature"    text,
    "Apprentice_signed_name"  text,
    "Apprentice_position"     text,
    "Apprentice_signed_at"    timestamptz,
    "Employer_signature"      text,
    "Employer_signed_name"    text,
    "Employer_position"       text,
    "Employer_signed_at"      timestamptz,
    "Provider_signature"      text,
    "Provider_signed_name"    text,
    "Provider_position"       text,
    "Provider_signed_at"      timestamptz,

    -- True only once all three have signed.
    "Fully_signed"      boolean NOT NULL DEFAULT false,

    "Status"            varchar(32) NOT NULL DEFAULT 'active',
    "Created_at"        timestamptz NOT NULL DEFAULT now(),
    "Updated_at"        timestamptz NOT NULL DEFAULT now()
);
"""

INDEXES = (
    f'''CREATE UNIQUE INDEX IF NOT EXISTS training_plan_documents_one_active
        ON {TABLE} ("Learner_kind", "Learner_id") WHERE "Status" = 'active';''',
    f'''CREATE INDEX IF NOT EXISTS training_plan_documents_learner
        ON {TABLE} ("Learner_kind", "Learner_id");''',
)


def _exists(cursor):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'enrolment' AND table_name = 'Training_Plan_Documents'
        """
    )
    return cursor.fetchone() is not None


class Command(BaseCommand):
    help = 'Create enrolment."Training_Plan_Documents".'

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Report state, then exit.")
        parser.add_argument(
            "--drop",
            action="store_true",
            help="Drop and recreate. Destroys every training plan — development only.",
        )

    def handle(self, *args, **options):
        with connections[CONN].cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS enrolment")
            exists = _exists(cursor)
            self.stdout.write(f"{TABLE} exists: {exists}")

            if options["check"]:
                if exists:
                    cursor.execute(f"SELECT count(*) FROM {TABLE}")
                    self.stdout.write(f"  rows: {cursor.fetchone()[0]}")
                return

            if options["drop"] and exists:
                cursor.execute(f"DROP TABLE {TABLE}")
                self.stdout.write(self.style.WARNING("Dropped the existing table."))
                exists = False

            cursor.execute(DDL)
            for statement in INDEXES:
                cursor.execute(statement)

            self.stdout.write(
                self.style.SUCCESS(f"{TABLE} is ready." if exists else f"Created {TABLE}.")
            )
