from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("qms_api", "0006_deepdiverecord_operational_overrides")]

    operations = [
        migrations.CreateModel(
            name="FeedbackFindingState",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("response_id", models.PositiveBigIntegerField(unique=True)),
                ("status", models.CharField(default="Open", max_length=20)),
                ("action_plan", models.TextField(blank=True, default="")),
                ("owner", models.CharField(blank=True, default="", max_length=255)),
                ("due_date", models.DateField(blank=True, null=True)),
                ("version", models.PositiveIntegerField(default=0)),
                ("updated_by", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "qms_feedback_finding_states"},
        ),
    ]
