from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("coach_api", "0002_move_calendar_event_to_coach_schema"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
            CREATE OR REPLACE FUNCTION "Coach".refresh_learner_absence_counts(
                affected_learner_id integer,
                affected_learner_email text
            )
            RETURNS void
            LANGUAGE plpgsql
            AS $$
            DECLARE
                present_count integer := 0;
                absent_count integer := 0;
                normalized_email text := lower(trim(coalesce(affected_learner_email, '')));
            BEGIN
                IF affected_learner_id IS NULL AND normalized_email = '' THEN
                    RETURN;
                END IF;

                SELECT
                    count(*) FILTER (
                        WHERE lower(trim(attendance_status::text)) IN ('1', 'true', 'yes', 'y', 'present', 'attended', 'attend')
                    ),
                    count(*) FILTER (
                        WHERE lower(trim(attendance_status::text)) IN ('0', 'false', 'no', 'n', 'absent', 'missed', 'did not attend', 'non-attendance')
                    )
                INTO present_count, absent_count
                FROM "Coach".learner_attendance_details
                WHERE (
                    affected_learner_id IS NOT NULL
                    AND learner_id = affected_learner_id
                )
                OR (
                    affected_learner_id IS NULL
                    AND normalized_email <> ''
                    AND lower(trim(learner_email::text)) = normalized_email
                );

                UPDATE "Learner"."Absence"
                SET present = coalesce(present_count, 0),
                    absent = coalesce(absent_count, 0),
                    updated_at = now()
                WHERE (
                    affected_learner_id IS NOT NULL
                    AND learner_id = affected_learner_id
                )
                OR (
                    affected_learner_id IS NULL
                    AND normalized_email <> ''
                    AND lower(trim(learner_email::text)) = normalized_email
                );
            END;
            $$;

            CREATE OR REPLACE FUNCTION "Coach".sync_learner_absence_counts_from_details()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF TG_OP IN ('UPDATE', 'DELETE') THEN
                    PERFORM "Coach".refresh_learner_absence_counts(OLD.learner_id, OLD.learner_email);
                END IF;

                IF TG_OP IN ('INSERT', 'UPDATE') THEN
                    PERFORM "Coach".refresh_learner_absence_counts(NEW.learner_id, NEW.learner_email);
                    RETURN NEW;
                END IF;

                RETURN OLD;
            END;
            $$;

            -- These reporting tables are externally managed and intentionally
            -- absent from a fresh Django test database. Install/backfill the
            -- trigger only where both source and target tables already exist.
            DO $migration$
            BEGIN
                IF to_regclass('"Coach".learner_attendance_details') IS NOT NULL
                   AND to_regclass('"Learner"."Absence"') IS NOT NULL THEN
                    DROP TRIGGER IF EXISTS learner_attendance_details_sync_absence_counts
                    ON "Coach".learner_attendance_details;

                    CREATE TRIGGER learner_attendance_details_sync_absence_counts
                    AFTER INSERT OR UPDATE OR DELETE
                    ON "Coach".learner_attendance_details
                    FOR EACH ROW
                    EXECUTE FUNCTION "Coach".sync_learner_absence_counts_from_details();

                    WITH detail_counts AS (
                        SELECT
                            learner_id,
                            count(*) FILTER (
                                WHERE lower(trim(attendance_status::text)) IN ('1', 'true', 'yes', 'y', 'present', 'attended', 'attend')
                            ) AS present_count,
                            count(*) FILTER (
                                WHERE lower(trim(attendance_status::text)) IN ('0', 'false', 'no', 'n', 'absent', 'missed', 'did not attend', 'non-attendance')
                            ) AS absent_count
                        FROM "Coach".learner_attendance_details
                        WHERE learner_id IS NOT NULL
                        GROUP BY learner_id
                    )
                    UPDATE "Learner"."Absence" absence
                    SET present = detail_counts.present_count,
                        absent = detail_counts.absent_count,
                        updated_at = now()
                    FROM detail_counts
                    WHERE absence.learner_id = detail_counts.learner_id;
                END IF;
            END
            $migration$;
            """,
            reverse_sql="""
            DO $migration$
            BEGIN
                IF to_regclass('"Coach".learner_attendance_details') IS NOT NULL THEN
                    DROP TRIGGER IF EXISTS learner_attendance_details_sync_absence_counts
                    ON "Coach".learner_attendance_details;
                END IF;
            END
            $migration$;
            DROP FUNCTION IF EXISTS "Coach".sync_learner_absence_counts_from_details();
            DROP FUNCTION IF EXISTS "Coach".refresh_learner_absence_counts(integer, text);
            """,
        ),
    ]
