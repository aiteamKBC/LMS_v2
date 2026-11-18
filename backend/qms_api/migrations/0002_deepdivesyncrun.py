from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0001_initial")]
    operations = [
        migrations.CreateModel(
            name="DeepDiveSyncRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("month_key", models.CharField(max_length=7, unique=True)),
                ("source", models.CharField(default="enrolment.Created_users", max_length=64)),
                ("added_count", models.PositiveIntegerField(default=0)),
                ("updated_by", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"db_table": "qms_deep_dive_sync_runs", "ordering": ("-month_key",)},
        ),
    ]
