"""Add and maintain EPA milestone dates on both learner mirror tables.

The source ``End_date`` columns are text in the live database, so the trigger
parses their ISO date values and safely clears the milestones when the source is
blank or invalid.
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction


CONNECTION = "enrolment"
TABLES = ("Active_users", "Unactive_users")
FUNCTION_NAME = '"Learner".set_epa_milestone_dates'


class Command(BaseCommand):
    help = "Add, backfill, and automatically maintain EPA milestone dates."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Apply all checks in a transaction and roll it back.",
        )

    @staticmethod
    def _milestone_counts(cursor, table_name):
        cursor.execute(
            f'''SELECT count(*),
                       count("Alert_notify_for_EPA"),
                       count("Enter_EPA"),
                       count("Gateway_review_date")
                FROM "Learner"."{table_name}"'''
        )
        return cursor.fetchone()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        with transaction.atomic(using=CONNECTION):
            cursor = connections[CONNECTION].cursor()

            for table_name in TABLES:
                cursor.execute(
                    f'ALTER TABLE "Learner"."{table_name}" '
                    'ADD COLUMN IF NOT EXISTS "Alert_notify_for_EPA" date'
                )
                cursor.execute(
                    f'ALTER TABLE "Learner"."{table_name}" '
                    'ADD COLUMN IF NOT EXISTS "Enter_EPA" date'
                )
                # This column predates this migration in the live database.
                cursor.execute(
                    f'ALTER TABLE "Learner"."{table_name}" '
                    'ADD COLUMN IF NOT EXISTS "Gateway_review_date" date'
                )

            cursor.execute(
                f'''
                CREATE OR REPLACE FUNCTION {FUNCTION_NAME}()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    parsed_end_date date;
                BEGIN
                    BEGIN
                        parsed_end_date := NULLIF(btrim(NEW."End_date"), '')::date;
                    EXCEPTION
                        WHEN invalid_text_representation OR datetime_field_overflow THEN
                            parsed_end_date := NULL;
                    END;

                    IF parsed_end_date IS NULL THEN
                        NEW."Alert_notify_for_EPA" := NULL;
                        NEW."Enter_EPA" := NULL;
                        NEW."Gateway_review_date" := NULL;
                    ELSE
                        NEW."Alert_notify_for_EPA" := (parsed_end_date - INTERVAL '2 months')::date;
                        NEW."Enter_EPA" := parsed_end_date + 7;
                        NEW."Gateway_review_date" := parsed_end_date + 14;
                    END IF;
                    RETURN NEW;
                END;
                $function$
                '''
            )

            for table_name in TABLES:
                trigger_name = f"set_{table_name.lower()}_epa_milestones"
                cursor.execute(
                    f'DROP TRIGGER IF EXISTS "{trigger_name}" '
                    f'ON "Learner"."{table_name}"'
                )
                cursor.execute(
                    f'CREATE TRIGGER "{trigger_name}" '
                    'BEFORE INSERT OR UPDATE OF "End_date" '
                    f'ON "Learner"."{table_name}" '
                    f'FOR EACH ROW EXECUTE FUNCTION {FUNCTION_NAME}()'
                )

                # Reassigning End_date fires the trigger and backfills every
                # existing row, including clearing stale dates for blank values.
                cursor.execute(
                    f'UPDATE "Learner"."{table_name}" '
                    'SET "End_date" = "End_date"'
                )
                counts = self._milestone_counts(cursor, table_name)
                self.stdout.write(
                    f"{table_name}: rows={counts[0]}, alert={counts[1]}, "
                    f"enter_epa={counts[2]}, gateway={counts[3]}"
                )

            if dry_run:
                transaction.set_rollback(True, using=CONNECTION)
                self.stdout.write(self.style.WARNING("Dry run complete; changes rolled back."))
            else:
                self.stdout.write(self.style.SUCCESS("EPA milestone columns committed."))
