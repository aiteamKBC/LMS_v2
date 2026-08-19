"""Create the ``Manual_audit`` schema and sync its mirror from ``Last_audit``.

The Manual audit workspace reads learners/activities from its own schema so
work there never touches the automatic system. The single source of truth for
that shared data stays ``Last_audit``; this command copies it:

    python manage.py setup_manual_audit            # create + full data sync
    python manage.py setup_manual_audit --skip-data  # create structures only

The mirror tables are always safe to re-sync (truncate + reload): every manual
edit lives in the Manual_audit write tables (activity_overrides,
activity_annotations, learner_hours_overrides, monthly_audit_signoffs,
learner_evidence_overrides, contract_document_archive, contract_uploads),
which this command never clears.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction

from ...contract_documents import ensure_contract_archive_table, ensure_contract_uploads_table
from ...evidence_documents import ensure_evidence_override_table
from ...match_ledger_views import (
    _ensure_activity_overlay_table,
    _ensure_annotation_table,
    _ensure_learner_hours_table,
    _ensure_profile_dates_table,
    _ensure_signature_cache_table,
)
from ...plan_tables import ensure_plan_tables
from ...signoff_views import _ensure_signoff_table


SOURCE_SCHEMA = "Last_audit"
TARGET_SCHEMA = "Manual_audit"

# Shared source data mirrored one-way into Manual_audit.
MIRROR_TABLES = [
    "learners",
    "groups",
    "group_learners",
    "activities",
    "activity_results",
    "learner_attendance",
    "activity_planned_hours",
    "activity_actual_hours",
]


def _pick_alias():
    for alias in ("audit", "enrolment", "default"):
        if alias in connections.databases:
            return alias
    raise CommandError("No usable database alias is configured.")


class Command(BaseCommand):
    help = "Create the Manual_audit schema, its tables, and sync mirror data from Last_audit."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-data",
            action="store_true",
            help="Create the schema and tables but do not copy any rows.",
        )
        parser.add_argument(
            "--database",
            default=None,
            help="Database alias to run against (defaults to audit/enrolment/default).",
        )

    def handle(self, *args, **options):
        alias = options["database"] or _pick_alias()
        if alias not in connections.databases:
            raise CommandError(f"Unknown database alias '{alias}'.")
        connection = connections[alias]

        try:
            with connection.cursor() as cursor:
                cursor.execute('create schema if not exists "Manual_audit"')
                self.stdout.write(f'Schema "{TARGET_SCHEMA}" is present (database alias: {alias}).')

                for table in MIRROR_TABLES:
                    cursor.execute(
                        f'create table if not exists "{TARGET_SCHEMA}"."{table}" '
                        f'(like "{SOURCE_SCHEMA}"."{table}" including all)'
                    )
                self.stdout.write(f"Mirror tables ready: {', '.join(MIRROR_TABLES)}.")

                # Manual-owned write tables (never touched by the sync below).
                _ensure_annotation_table(cursor)
                _ensure_activity_overlay_table(cursor)
                _ensure_learner_hours_table(cursor)
                _ensure_profile_dates_table(cursor)
                _ensure_signature_cache_table(cursor)
                _ensure_signoff_table(cursor)
                ensure_evidence_override_table(cursor)
                ensure_contract_archive_table(cursor)
                ensure_contract_uploads_table(cursor)
                ensure_plan_tables(cursor)
                self.stdout.write(
                    "Write tables ready: activity_annotations, activity_overrides, "
                    "learner_hours_overrides, contract_signature_cache, "
                    "monthly_audit_signoffs, learner_evidence_overrides, "
                    "contract_document_archive, contract_uploads, "
                    "plan_* (plan builder: groups, months, activities, members, "
                    "progress, member_dates, exemptions, assignment_refs, events) "
                    "+ manual_programmes/_aliases."
                )
        except DatabaseError as error:
            raise CommandError(f"Could not create the Manual_audit structures: {error}")

        if options["skip_data"]:
            self.stdout.write(self.style.SUCCESS("Structures created; data sync skipped."))
            return

        try:
            with transaction.atomic(using=alias):
                with connection.cursor() as cursor:
                    for table in MIRROR_TABLES:
                        cursor.execute(f'truncate table "{TARGET_SCHEMA}"."{table}"')
                        cursor.execute(
                            f'insert into "{TARGET_SCHEMA}"."{table}" '
                            f'select * from "{SOURCE_SCHEMA}"."{table}"'
                        )
                        cursor.execute(f'select count(*) from "{TARGET_SCHEMA}"."{table}"')
                        count = cursor.fetchone()[0]
                        self.stdout.write(f"  {table}: {count} rows synced")
        except DatabaseError as error:
            raise CommandError(f"Could not sync data from Last_audit: {error}")

        self.stdout.write(self.style.SUCCESS("Manual_audit is set up and in sync with Last_audit."))
