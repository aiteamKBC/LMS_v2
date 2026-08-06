"""Create enrolment."ILR_Documents".

The Individual Learner Record is the learner's funding-and-eligibility record.
It is signed by the learner (the learning declaration) and by the provider (the
Provider/Sub-contractor declaration confirming identity and eligibility evidence
was seen). The employer has no part in it and never sees it.

Same shape as Apprenticeship_Agreements, and for the same reason: the answers
are SNAPSHOT onto the row at issue, so a signed ILR cannot be rewritten by the
learner later editing their enrolment wizard.

    python manage.py apply_ilr_documents_table --check
    python manage.py apply_ilr_documents_table
"""
from django.core.management.base import BaseCommand
from django.db import connection

TABLE = 'enrolment."ILR_Documents"'

DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    id                  uuid PRIMARY KEY,

    "Learner_kind"      varchar(32) NOT NULL,
    "Learner_id"        bigint      NOT NULL,

    -- ---- The record, snapshot at issue --------------------------------
    -- Learner details as printed on page 1.
    "Learner_details"   jsonb,
    -- The Extended ILR questionnaire: contact prefs, next of kin, eligibility,
    -- employer, other training, circumstances, understanding, consents.
    "Answers"           jsonb,

    -- ---- Signatories --------------------------------------------------
    -- The learner signs the learning declaration; the provider signs the
    -- Provider/Sub-contractor declaration. The employer does NOT sign an ILR.
    "Learner_signature"     text,
    "Learner_signed_name"   text,
    "Learner_signed_at"     timestamptz,
    "Provider_signature"    text,
    "Provider_signed_name"  text,
    "Provider_signed_at"    timestamptz,

    "Fully_signed"      boolean NOT NULL DEFAULT false,

    "Status"            varchar(32) NOT NULL DEFAULT 'active',
    "Created_at"        timestamptz NOT NULL DEFAULT now(),
    "Updated_at"        timestamptz NOT NULL DEFAULT now()
);
"""

INDEXES = (
    f'''CREATE UNIQUE INDEX IF NOT EXISTS ilr_documents_one_active
        ON {TABLE} ("Learner_kind", "Learner_id") WHERE "Status" = 'active';''',
    f'''CREATE INDEX IF NOT EXISTS ilr_documents_learner
        ON {TABLE} ("Learner_kind", "Learner_id");''',
)


def _exists(cursor):
    cursor.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'enrolment' AND table_name = 'ILR_Documents'
        """
    )
    return cursor.fetchone() is not None


class Command(BaseCommand):
    help = 'Create enrolment."ILR_Documents".'

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Report state, then exit.")
        parser.add_argument(
            "--drop",
            action="store_true",
            help="Drop and recreate. Destroys every ILR document — development only.",
        )

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
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
