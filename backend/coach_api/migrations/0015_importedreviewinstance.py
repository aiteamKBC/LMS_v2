from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("coach_api", "0014_coachdashboardsnapshot"),
    ]

    operations = [
        migrations.CreateModel(
            name="ImportedReviewInstance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_key", models.CharField(max_length=255)),
                ("owner_email", models.EmailField(db_index=True, max_length=255)),
                ("learner_id", models.IntegerField(db_index=True)),
                ("answers", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("in-progress", "In Progress"), ("completed", "Completed")], db_index=True, default="in-progress", max_length=32)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": 'Coach"."coach_imported_review_instance',
            },
        ),
        migrations.AddConstraint(
            model_name="importedreviewinstance",
            constraint=models.UniqueConstraint(fields=("owner_email", "event_key"), name="coach_imported_review_owner_event_unique"),
        ),
        migrations.AddConstraint(
            model_name="importedreviewinstance",
            constraint=models.CheckConstraint(condition=models.Q(status__in=["in-progress", "completed"]), name="coach_imported_review_status_valid"),
        ),
    ]
