"""Create enrolment."Written_Agreements".

The Written Agreement is the commercial agreement between the employer and the
main provider. It records the delivery the provider will give, the End Point
Assessment arrangements, the cost breakdown against the funding band, and the
process for queries and complaints.

The printed template is signed by the employer, the EPAO and the provider. Here
it is signed by the learner, the employer and the provider — the same three
parties as the Training Plan, so a learner signs their own paperwork from one
place.

Content is SNAPSHOT at issue, like the other three documents.

    python manage.py apply_written_agreements_table --check
    python manage.py apply_written_agreements_table
"""
from django.core.management.base import BaseCommand
from django.db import connections

# These tables live in the Neon `enrolment` schema, which EnrolmentRouter
# sends every model read and write to. Creating them on the `default` alias
# only worked because .env sets a single Database_url that both aliases
# resolve to; split them and the DDL lands on one database while the ORM
# queries another. Use the same alias the models use.
CONN = "enrolment"

TABLE = 'enrolment."Written_Agreements"'

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id                  uuid PRIMARY KEY,

    "Learner_kind"      varchar(32) NOT NULL,
    "Learner_id"        bigint      NOT NULL,

    -- ---- Content, snapshot at issue -----------------------------------
    -- The header block: apprentice, job title, standard, level, funding band,
    -- dates, manager, employer and address, main provider, subcontracting.
    "Particulars"       jsonb,
    -- Delivery: the off-the-job activities, English/maths and assessment.
    "Delivery"          jsonb,
    -- End Point Assessment organisation and arrangements.
    "Epa"               jsonb,
    -- The costs table: line items, total, funding band and balance. No source
    -- in the system yet, so these are blank for an officer to complete.
    "Costs"             jsonb,
    -- Complaints/queries contacts.
    "Contacts"          jsonb,

    -- ---- Signatories: learner, employer, provider ---------------------
    "Learner_signature"      text,
    "Learner_signed_name"    text,
    "Learner_position"       text,
    "Learner_signed_at"      timestamptz,
    "Employer_signature"     text,
    "Employer_signed_name"   text,
    "Employer_position"      text,
    "Employer_signed_at"     timestamptz,
    "Provider_signature"     text,
    "Provider_signed_name"   text,
    "Provider_position"      text,
    "Provider_signed_at"     timestamptz,

    "Fully_signed"      boolean NOT NULL DEFAULT false,

    "Status"            varchar(32) NOT NULL DEFAULT 'active',
    "Created_at"        timestamptz NOT NULL DEFAULT now(),
    "Updated_at"        timestamptz NOT NULL DEFAULT now()
);
"""

INDEXES = (
    f'''CREATE UNIQUE INDEX IF NOT EXISTS written_agreements_one_active
        ON {TABLE} ("Learner_kind", "Learner_id") WHERE "Status" = 'active';''',
    f'''CREATE INDEX IF NOT EXISTS written_agreements_learner
        ON {TABLE} ("Learner_kind", "Learner_id");''',
)


def _exists(cursor):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'enrolment' AND table_name = 'Written_Agreements'
        """
    )
    return cursor.fetchone() is not None


class Command(BaseCommand):
    help = 'Create enrolment."Written_Agreements".'

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Report state, then exit.")
        parser.add_argument(
            "--drop",
            action="store_true",
            help="Drop and recreate. Destroys every written agreement — development only.",
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
