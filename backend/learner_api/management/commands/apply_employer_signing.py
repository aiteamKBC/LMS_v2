"""Add the columns behind employer-side document signing.

Three additions:

  1. enrolment."Employers"."Signature" / "Signature_name" / "Signature_date"
     — the employer's own saved signature, as asked for. Same PNG data URL format
     SignaturePad produces, so it can be offered as the default when signing
     (mirroring how a learner reuses their enrolment signature) instead of
     redrawing it for every document.

  2. enrolment."Enrolment_Reviews"."Employer_signature" / "_signed_name" /
     "_signed_at" — a third signing party alongside the existing learner and
     admin columns, so a review can require an employer sign-off.

  3. enrolment."Enrolment_Documents"."Employer_signature" / "_signed_name" /
     "_signed_at" — the compliance PDFs (Apprenticeship Agreement, Commitment
     Statement, Training Plan) had a bare "Signed" boolean and nowhere to record
     who signed or what mark they gave. These add that, leaving "Signed" as the
     summary flag the existing list already reads.

All nullable/defaulted, so existing rows are untouched and unsigned.

Run it once:

    python manage.py apply_employer_signing            # apply
    python manage.py apply_employer_signing --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"

# table -> ((column, type), ...)
ADDITIONS = {
    "Employers": (
        ("Signature", "text"),
        ("Signature_name", "text"),
        ("Signature_date", "timestamptz"),
    ),
    "Enrolment_Reviews": (
        ("Employer_signature", "text"),
        ("Employer_signed_name", "text"),
        ("Employer_signed_at", "timestamptz"),
        # Whether this review needs an employer signature at all. Health & Safety
        # is employer-facing; the RPL review is not. Nullable so the API decides
        # the default per review type rather than the DDL freezing it.
        ("Employer_signature_required", "boolean"),
    ),
    "Enrolment_Documents": (
        ("Employer_signature", "text"),
        ("Employer_signed_name", "text"),
        ("Employer_signed_at", "timestamptz"),
    ),
}


class Command(BaseCommand):
    help = "Add employer signature columns to Employers, Enrolment_Reviews and Enrolment_Documents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan without committing (rolls back).",
        )

    def _columns(self, cur, table):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name=%s "
            "ORDER BY ordinal_position",
            [table],
        )
        return {name: dtype for name, dtype in cur.fetchall()}

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                for table, columns in ADDITIONS.items():
                    existing = self._columns(cur, table)
                    if not existing:
                        self.stderr.write(self.style.ERROR(
                            f'enrolment."{table}" does not exist — skipping. '
                            "Run the command that creates it first."
                        ))
                        continue

                    self.stdout.write(f'\n===== enrolment."{table}" =====')
                    for name, sql_type in columns:
                        already = name in existing
                        cur.execute(
                            f'ALTER TABLE enrolment."{table}" '
                            f'ADD COLUMN IF NOT EXISTS "{name}" {sql_type}'
                        )
                        self.stdout.write(
                            f'  {"exists" if already else "added "} "{name}" {sql_type}'
                        )

                # Employer-signed documents are looked up per employer for their
                # "what still needs signing?" list.
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_reviews_employer_signed_idx '
                    'ON enrolment."Enrolment_Reviews" ("Employer_signed_at")'
                )

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
