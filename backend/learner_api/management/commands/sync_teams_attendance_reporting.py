from django.core.management.base import BaseCommand
from django.db import connections, router, transaction

from learner_api.models import LearnerProfile
from learner_api.teams_attendance import (
    ATTENDANCE_REPORTING_TABLE,
    ensure_teams_attendance_reporting_columns,
    sync_verified_teams_attendance_reporting,
)


class Command(BaseCommand):
    help = "Backfill the flat learner attendance reporting table from verified Teams reports."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace-legacy",
            action="store_true",
            help="Archive and remove legacy/demo rows before writing verified Teams rows.",
        )

    def handle(self, *args, **options):
        database = router.db_for_write(LearnerProfile) or "default"
        ensure_teams_attendance_reporting_columns(database)

        if options["replace_legacy"]:
            with transaction.atomic(using=database):
                with connections[database].cursor() as cursor:
                    cursor.execute(
                        f"""
                        CREATE TABLE IF NOT EXISTS
                            "Learner"."learner_attendance_details_legacy_backup"
                        AS TABLE {ATTENDANCE_REPORTING_TABLE} WITH NO DATA
                        """
                    )
                    cursor.execute(
                        f"""
                        INSERT INTO "Learner"."learner_attendance_details_legacy_backup"
                        SELECT legacy.*
                        FROM {ATTENDANCE_REPORTING_TABLE} legacy
                        WHERE COALESCE(legacy.source, 'legacy') <> 'microsoft_teams'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM "Learner"."learner_attendance_details_legacy_backup" backup
                              WHERE backup.id = legacy.id
                          )
                        """
                    )
                    archived = cursor.rowcount
                    cursor.execute(
                        f"""
                        DELETE FROM {ATTENDANCE_REPORTING_TABLE}
                        legacy
                        WHERE COALESCE(legacy.source, 'legacy') <> 'microsoft_teams'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM "Coach"."coach_absence_report" report
                              WHERE report.attendance_id = legacy.id
                          )
                        """
                    )
                    deleted = cursor.rowcount
                    cursor.execute(
                        f"""
                        SELECT count(*)
                        FROM {ATTENDANCE_REPORTING_TABLE}
                        legacy
                        WHERE COALESCE(legacy.source, 'legacy') <> 'microsoft_teams'
                        """
                    )
                    retained = cursor.fetchone()[0]
            self.stdout.write(
                self.style.WARNING(
                    f"Archived {archived}, removed {deleted} unreferenced legacy/demo rows, "
                    f"and retained {retained} rows required by absence reports."
                )
            )

        count = sync_verified_teams_attendance_reporting(all_learners=True)
        self.stdout.write(
            self.style.SUCCESS(
                f"Upserted {count} verified Microsoft Teams attendance rows."
            )
        )
