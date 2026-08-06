"""Create enrolment."Apprenticeship_Agreements".

The Apprenticeship Agreement is a statutory contract of service between the
apprentice and their employer (ASCLA 2009 / the 2017 Regulations), not just
another generated PDF — so it gets its own table rather than sharing the generic
Enrolment_Documents index.

Why its own table:

  * The particulars are SNAPSHOT onto the row when the agreement is issued.
    What each party put their name to is then fixed: editing the learning plan
    or moving the group's dates afterwards cannot silently rewrite a signed
    statutory record.
  * Two named signatories, apprentice and employer, each with their own mark,
    name and timestamp. The provider does not sign this document (note 6).
  * One live agreement per learner, enforced by a partial unique index, with
    superseded versions kept for audit rather than deleted.

--drop recreates the table from scratch (development only).

    python manage.py apply_apprenticeship_agreements_table --check
    python manage.py apply_apprenticeship_agreements_table
"""
from django.core.management.base import BaseCommand
from django.db import connection

TABLE = 'enrolment."Apprenticeship_Agreements"'

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id                  uuid PRIMARY KEY,

    -- Who the agreement is for. Learner_kind mirrors the rest of the enrolment
    -- schema ('apprenticeship' | 'commercial').
    "Learner_kind"      varchar(32)  NOT NULL,
    "Learner_id"        bigint       NOT NULL,

    -- ---- Particulars, snapshot at issue -------------------------------
    -- Frozen copies, NOT live lookups: a signed agreement must keep saying what
    -- it said when it was signed.
    "Apprentice_name"   text,
    "Employer_name"     text,
    "Employer_address"  text,
    "Standard"          text,
    "Start_date"        date,
    "End_date"          date,
    "Practical_start"   date,
    "Practical_end"     date,
    -- Weeks between the practical period's start and end, to 1dp.
    "Duration_weeks"    numeric(8, 1),
    -- Planned off-the-job hours: the learning plan total at issue.
    "Planned_otjh"      numeric(10, 2),
    -- The modules that total came from, so the figure can be justified later.
    "Plan_modules"      jsonb,

    -- ---- Signatories --------------------------------------------------
    -- PNG data URLs, as SignaturePad produces.
    "Apprentice_signature"   text,
    "Apprentice_signed_name" text,
    "Apprentice_signed_at"   timestamptz,
    "Employer_signature"     text,
    "Employer_signed_name"   text,
    "Employer_signed_at"     timestamptz,

    -- True once BOTH parties have signed. Maintained by the API, not a
    -- generated column, so the rule lives in one readable place.
    "Fully_signed"      boolean NOT NULL DEFAULT false,

    -- ---- The rendered PDF ---------------------------------------------
    -- Regenerated whenever a signature changes, so the filed document always
    -- shows the marks actually on record.
    "Container"         varchar(128),
    "Blob_name"         varchar(512),
    "Doc_path"          text,
    "Size_bytes"        bigint,

    -- ---- Lifecycle ----------------------------------------------------
    -- 'active' | 'superseded'. A reissued agreement supersedes the previous one
    -- rather than deleting it: it is a compliance record.
    "Status"            varchar(32) NOT NULL DEFAULT 'active',
    "Created_at"        timestamptz NOT NULL DEFAULT now(),
    "Updated_at"        timestamptz NOT NULL DEFAULT now()
);
"""

INDEXES = (
    # One active agreement per learner. Partial, so superseded rows can pile up.
    f'''CREATE UNIQUE INDEX IF NOT EXISTS apprenticeship_agreements_one_active
        ON {TABLE} ("Learner_kind", "Learner_id") WHERE "Status" = 'active';''',
    f'''CREATE INDEX IF NOT EXISTS apprenticeship_agreements_learner
        ON {TABLE} ("Learner_kind", "Learner_id");''',
)


def _exists(cursor):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'enrolment' AND table_name = 'Apprenticeship_Agreements'
        """
    )
    return cursor.fetchone() is not None


class Command(BaseCommand):
    help = 'Create enrolment."Apprenticeship_Agreements".'

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Report state, then exit.")
        parser.add_argument(
            "--drop",
            action="store_true",
            help="Drop and recreate the table. Destroys every agreement — development only.",
        )

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute("CREATE SCHEMA IF NOT EXISTS enrolment")
            exists = _exists(cursor)
            self.stdout.write(f"{TABLE} exists: {exists}")

            if options["check"]:
                if exists:
                    cursor.execute(f'SELECT count(*) FROM {TABLE}')
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
                self.style.SUCCESS(
                    f"{TABLE} is ready." if exists else f"Created {TABLE}."
                )
            )
