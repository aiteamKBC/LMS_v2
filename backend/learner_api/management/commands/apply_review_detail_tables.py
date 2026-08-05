"""Create the per-review-type detail tables, linked to enrolment."Enrolment_Reviews".

    enrolment."Review_Eligibility"     - Eligibility Review & FS Discussion
    enrolment."Review_RPL"             - RPL And Experience
    enrolment."Review_Health_Safety"   - Workplace Health & Safety Declaration

Each row belongs to one Enrolment_Reviews row via Review_id (ON DELETE CASCADE),
one row per review, so the answers for each review type get real columns to
report on. Enrolment_Reviews.Form_answers remains the working store the form
reads and writes; review_tables.sync_review_detail projects it into these tables
on every save.

Idempotent: safe to re-run. Creates each table if absent and adds any missing
column, so adding a question later means adding an ADD COLUMN IF NOT EXISTS line
here rather than a hand-run ALTER.

    python manage.py apply_review_detail_tables            # apply
    python manage.py apply_review_detail_tables --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
PARENT = "Enrolment_Reviews"

# Columns every detail table shares.
COMMON_COLUMNS = """
    id              bigserial PRIMARY KEY,
    "Review_id"     bigint NOT NULL REFERENCES enrolment."Enrolment_Reviews"(id) ON DELETE CASCADE,
    "Event_key"     text NOT NULL,
    "Learner_id"    bigint NOT NULL,
    "Learner_name"  text,
    "Completed"     boolean NOT NULL DEFAULT false,
    "Created_at"    timestamptz NOT NULL DEFAULT now(),
    "Updated_at"    timestamptz NOT NULL DEFAULT now()
"""

COMMON_ADD = [
    ('"Event_key"', "text"),
    ('"Learner_id"', "bigint"),
    ('"Learner_name"', "text"),
    ('"Completed"', "boolean NOT NULL DEFAULT false"),
    ('"Created_at"', "timestamptz NOT NULL DEFAULT now()"),
    ('"Updated_at"', "timestamptz NOT NULL DEFAULT now()"),
]

# Per-table answer columns. Yes/No answers are stored as the literal answer text
# rather than a boolean: the forms allow an unanswered question, and '' reads
# better than NULL-as-unknown when reporting.
TABLES = {
    "Review_Eligibility": [
        ('"Over_16"', "text"),
        ('"Within_contract_time"', "text"),
        ('"PAYE_scheme"', "text"),
        ('"Eligible_residency"', "text"),
        ('"Identity_documents_seen"', "text"),
        ('"Eligibility_evidence"', "text"),
        ('"Right_to_work_England"', "text"),
        ('"Fifty_percent_England"', "text"),
        ('"Minimum_wage"', "text"),
        # Variable-length collections stay jsonb.
        ('"Initial_assessments"', "jsonb"),
        ('"Diagnostic_assessments"', "jsonb"),
        ('"Exemption_English"', "text"),
        ('"Exemption_Maths"', "text"),
        ('"Exemption_ICT"', "text"),
        ('"FS_results"', "jsonb"),
        ('"Holds_level_2"', "text"),
        ('"Level_matches_role"', "text"),
        ('"Productive_purpose"', "text"),
        ('"KSB_exposure"', "text"),
        ('"Release_for_OTJ"', "text"),
        ('"Embed_OTJ"', "text"),
        ('"Warning_areas"', "text"),
        ('"Comments"', "text"),
        ('"Programme_status"', "text"),
    ],
    "Review_RPL": [
        ('"Prior_learning_items"', "jsonb"),
        ('"Apprenticeship_appropriate"', "text"),
        ('"Plan_aligns_standard"', "text"),
        ('"Prior_education"', "text"),
        ('"Prior_work_experience"', "text"),
        ('"Plan_needs_adjusting"', "text"),
        ('"ULN"', "text"),
        ('"Reported_attainment"', "text"),
        ('"Attainment_English"', "text"),
        ('"Attainment_Maths"', "text"),
        ('"Attainment_ICT"', "text"),
        ('"Skills_radar_notes"', "text"),
        ('"Comments"', "text"),
    ],
    "Review_Health_Safety": [
        ('"Basic_arrangements"', "text"),
        ('"Day_one_induction"', "text"),
        ('"Fire_safety"', "text"),
        ('"First_aid"', "text"),
        ('"Supervision"', "text"),
        ('"PPE"', "text"),
        ('"Accident_recording"', "text"),
        ('"Inform_changes"', "text"),
        ('"HS_policy"', "text"),
        ('"Liability_insurance"', "text"),
    ],
}


class Command(BaseCommand):
    help = "Create/patch the per-review-type detail tables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after column lists without committing (rolls back).",
        )

    def _columns(self, cur, table):
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name=%s ORDER BY ordinal_position",
            [table],
        )
        return [row[0] for row in cur.fetchall()]

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                # The FK target must exist, or every CREATE below fails with a
                # confusing "relation does not exist" on the parent.
                cur.execute(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='enrolment' AND table_name=%s",
                    [PARENT],
                )
                if cur.fetchone() is None:
                    raise RuntimeError(
                        f'enrolment."{PARENT}" does not exist — '
                        "run apply_enrolment_reviews_table first."
                    )

                for table, columns in TABLES.items():
                    before = self._columns(cur, table)
                    self.stdout.write(f"\n===== {table} =====")
                    self.stdout.write(f"  before: {len(before)} column(s)")

                    cur.execute(
                        f'CREATE TABLE IF NOT EXISTS enrolment."{table}" ({COMMON_COLUMNS})'
                    )
                    for name, ddl in COMMON_ADD + columns:
                        cur.execute(
                            f'ALTER TABLE enrolment."{table}" '
                            f"ADD COLUMN IF NOT EXISTS {name} {ddl}"
                        )
                    # One detail row per review.
                    cur.execute(
                        f'CREATE UNIQUE INDEX IF NOT EXISTS {table.lower()}_review_uniq '
                        f'ON enrolment."{table}" ("Review_id")'
                    )
                    cur.execute(
                        f'CREATE INDEX IF NOT EXISTS {table.lower()}_learner_idx '
                        f'ON enrolment."{table}" ("Learner_id")'
                    )

                    after = self._columns(cur, table)
                    self.stdout.write(f"  after : {len(after)} column(s)")
                    added = [c for c in after if c not in before]
                    if added:
                        self.stdout.write(f"  added : {', '.join(added)}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
