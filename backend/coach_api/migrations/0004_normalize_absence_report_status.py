from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("coach_api", "0003_sync_learner_absence_counts"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                UPDATE "Coach"."coach_absence_report"
                SET status = CASE
                    WHEN lower(trim(coalesce(status, ''))) IN ('pending', 'approved', 'declined')
                        THEN lower(trim(status))
                    ELSE 'pending'
                END
                WHERE status IS NULL
                   OR status <> CASE
                        WHEN lower(trim(coalesce(status, ''))) IN ('pending', 'approved', 'declined')
                            THEN lower(trim(status))
                        ELSE 'pending'
                    END;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
