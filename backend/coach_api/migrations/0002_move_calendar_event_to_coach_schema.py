from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("coach_api", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql="""
            CREATE SCHEMA IF NOT EXISTS "Coach";

            DO $$
            BEGIN
                IF to_regclass('"Coach".coach_calendar_event') IS NULL
                   AND to_regclass('public.coach_api_coachcalendarevent') IS NOT NULL THEN
                    ALTER TABLE public.coach_api_coachcalendarevent
                    SET SCHEMA "Coach";
                END IF;
            END $$;

            ALTER TABLE IF EXISTS "Coach".coach_api_coachcalendarevent
            RENAME TO coach_calendar_event;
            """,
                    reverse_sql="""
            DO $$
            BEGIN
                IF to_regclass('"Coach".coach_calendar_event') IS NOT NULL THEN
                    ALTER TABLE "Coach".coach_calendar_event
                    RENAME TO coach_api_coachcalendarevent;

                    ALTER TABLE "Coach".coach_api_coachcalendarevent
                    SET SCHEMA public;
                END IF;
            END $$;
            """,
                ),
            ],
            state_operations=[
                migrations.AlterModelTable(
                    name="coachcalendarevent",
                    table='Coach"."coach_calendar_event',
                ),
            ],
        ),
    ]
