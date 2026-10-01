from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0013_dashboard_review_read_indexes")]

    operations = [
        migrations.CreateModel(
            name="CoachDashboardSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_email", models.EmailField(max_length=255, unique=True)),
                ("payload", models.JSONField(default=dict)),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("refreshed_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": 'Coach"."coach_dashboard_snapshot'},
        ),
        migrations.AddIndex(
            model_name="coachdashboardsnapshot",
            index=models.Index(fields=["-refreshed_at"], name="coach_dash_snapshot_fresh_idx"),
        ),
    ]
