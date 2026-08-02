"""Add and backfill Audit.Aptem_LMS_matching.Learner_source_data.

One-off, idempotent migration. The json column keeps a display-ready hierarchy:
programme -> modules -> months -> weeks -> lectures/components.

Run it once:

    python manage.py apply_learner_source_data_column
    python manage.py apply_learner_source_data_column --dry-run
"""
import json

from django.core.management.base import BaseCommand
from django.db import connections, transaction

from audit_api.views import (
    AUDIT_SCHEMA,
    MAIN_TABLE,
    STUDENT_SOURCE_DATA_COLUMN,
    _build_student_source_data,
)

CONN = "enrolment"


class Command(BaseCommand):
    help = f'Add "{AUDIT_SCHEMA}"."{MAIN_TABLE}"."{STUDENT_SOURCE_DATA_COLUMN}" (json) and backfill it.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after column list and row count without committing.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Rows to backfill per transaction after the column exists.",
        )

    def _columns(self, cur):
        cur.execute(
            """
            select column_name, data_type
            from information_schema.columns
            where table_schema = %s
              and table_name = %s
            order by ordinal_position
            """,
            [AUDIT_SCHEMA, MAIN_TABLE],
        )
        return cur.fetchall()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        batch_size = max(1, options["batch_size"])
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                cur.execute("set local lock_timeout = '60s'")
                cur.execute("set local statement_timeout = '180s'")
                self.stdout.write("\n===== BEFORE =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                cur.execute(
                    f'alter table "{AUDIT_SCHEMA}"."{MAIN_TABLE}" '
                    f'add column if not exists "{STUDENT_SOURCE_DATA_COLUMN}" json'
                )
                cur.execute(
                    f'alter table "{AUDIT_SCHEMA}"."{MAIN_TABLE}" '
                    f'alter column "{STUDENT_SOURCE_DATA_COLUMN}" type json '
                    f'using "{STUDENT_SOURCE_DATA_COLUMN}"::json'
                )

                self.stdout.write("\n===== AFTER =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                    return

            updated = 0
            while True:
                with transaction.atomic(using=CONN):
                    cur = conn.cursor()
                    cur.execute("set local statement_timeout = '180s'")
                    cur.execute(
                        f"""
                        select
                            "Learner_ID",
                            "Learner_name",
                            "Programme_name",
                            "Completed_OTJH",
                            "LMS_Summary",
                            "Quiz_summary",
                            "LMS_modules_details",
                            "Aptem_components"
                        from "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                        where coalesce("{STUDENT_SOURCE_DATA_COLUMN}"->>'schema_version', '') <> 'learner-source-data-v6'
                        order by coalesce("Learner_name", ''), "Learner_ID"
                        limit %s
                        """,
                        [batch_size],
                    )
                    columns = [col[0] for col in cur.description]
                    rows = [dict(zip(columns, row)) for row in cur.fetchall()]
                    if not rows:
                        break

                    for row in rows:
                        payload = _build_student_source_data(row)
                        cur.execute(
                            f"""
                            update "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                            set "{STUDENT_SOURCE_DATA_COLUMN}" = %s::json
                            where "Learner_ID" is not distinct from %s
                              and "Learner_name" is not distinct from %s
                              and "Programme_name" is not distinct from %s
                            """,
                            [
                                json.dumps(payload, ensure_ascii=False, default=str),
                                row.get("Learner_ID"),
                                row.get("Learner_name"),
                                row.get("Programme_name"),
                            ],
                        )
                        updated += cur.rowcount

                self.stdout.write(f"Backfilled {updated} row(s)...")

            self.stdout.write(f"\nBackfilled {updated} row(s).")
            self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
