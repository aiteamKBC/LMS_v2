"""Track model state for timing provenance on the externally-owned table.

The Learner schema is deliberately not managed by Django migrations. Physical
columns are applied idempotently by ``apply_progress_time_tracking_schema``.
"""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0007_classify_and_repair_legacy_component_refs")]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="time_tracking_source",
                    field=models.TextField(blank=True, default=""),
                ),
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="time_tracking_calculation",
                    field=models.TextField(blank=True, default=""),
                ),
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="time_tracking_session_ref",
                    field=models.TextField(blank=True, default=""),
                ),
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="claimed_seconds",
                    field=models.PositiveIntegerField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="server_session_seconds",
                    field=models.PositiveIntegerField(blank=True, null=True),
                ),
                migrations.AddField(
                    model_name="learnerprogressentry",
                    name="verified_seconds",
                    field=models.PositiveIntegerField(blank=True, null=True),
                ),
            ],
        ),
    ]
