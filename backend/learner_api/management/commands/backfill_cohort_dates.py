"""Backfill the learner tables' cohort dates from the authored cohort table.

Start_date / End_date (the practical period) on all three tables, plus
Practical_period_end_date / Apprenticeship_End_date on Created_users — the
latter is the practical end date plus the cohort's EPA period.

The three tables (enrolment."Created_users", "Learner"."Active_users",
"Learner"."Unactive_users") already have Start_date /
End_date date columns; this fills existing rows from
curriculum."cohorts", matched by Programme + Cohort name
(case-insensitive, trimmed) — the learner tables have no cohort_id to join on.
New enrolments/mirrors are populated on write (see views.py / active_users.py),
so this only needs running once against pre-existing rows.

Run it:

    python manage.py backfill_cohort_dates            # apply
    python manage.py backfill_cohort_dates --dry-run  # show counts only (rolls back)
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"

# (label, schema-qualified table, programme column, cohort column, apprenticeship)
# `apprenticeship` marks the tables that also carry the practical/apprenticeship
# end date pair. Only Created_users has those columns; the Active/Unactive
# mirrors store the practical end date alone, in End_date.
TABLES = [
    # Created_users holds every learner (both kinds) since the cutover; it
    # replaced the old Enrolment_Users + Commercial_users pair.
    ("Created_users", 'enrolment"."Created_users', "Programme", "Cohort", True),
    ("Active_users", 'Learner"."Active_users', "Programme", "Cohort", False),
    ("Unactive_users", 'Learner"."Unactive_users', "Programme", "Cohort", False),
]


class Command(BaseCommand):
    help = "Backfill the learner tables' cohort delivery dates from curriculum.cohorts."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report how many rows would be updated without committing (rolls back).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]
        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                for label, table, prog_col, coh_col, apprenticeship in TABLES:
                    # End_date is the practical period end on every table. On
                    # Created_users the pair is spelled out: Practical_period_end_date
                    # repeats it under the apprenticeship name, and
                    # Apprenticeship_End_date is the cohort's apprenticeship end --
                    # the date authored on the cohort when there is one, otherwise
                    # its practical end plus its EPA period. curriculum.cohorts
                    # resolves that for us in apprenticeship_end_date, so there is
                    # nothing to recompute here. Those two columns are text, hence
                    # the casts.
                    extra_assignments = '''
                            "Practical_period_end_date" = c.end_date::text,
                            "Apprenticeship_End_date" = c.apprenticeship_end_date::text,''' if apprenticeship else ""
                    # Match each learner row to the newest authored cohort sharing
                    # its Programme + Cohort name. DISTINCT ON keeps one date pair
                    # per (programme, cohort) even if the cohort table has dupes.
                    sql = f'''
                        UPDATE "{table}" AS t
                        SET "Start_date" = c.start_date,{extra_assignments}
                            "End_date" = c.end_date
                        FROM (
                            SELECT DISTINCT ON (lower(btrim(programme_name)), lower(btrim(cohort_name)))
                                   lower(btrim(programme_name)) AS p,
                                   lower(btrim(cohort_name)) AS c,
                                   start_date, end_date, apprenticeship_end_date
                            FROM curriculum."cohorts"
                            ORDER BY lower(btrim(programme_name)),
                                     lower(btrim(cohort_name)),
                                     updated_at DESC NULLS LAST
                        ) AS c
                        WHERE lower(btrim(t."{prog_col}")) = c.p
                          AND lower(btrim(t."{coh_col}")) = c.c
                    '''
                    cur.execute(sql)
                    self.stdout.write(f"  {label}: {cur.rowcount} row(s) matched & updated")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Backfill failed (rolled back): {exc}"))
            raise
