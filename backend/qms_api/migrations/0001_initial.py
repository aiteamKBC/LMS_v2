from django.db import migrations, models
import uuid


class Migration(migrations.Migration):
    initial = True
    dependencies = []
    operations = [
        migrations.CreateModel(
            name="DeepDiveRecord",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("identity_key", models.CharField(max_length=255, unique=True)),
                ("source_file_name", models.CharField(blank=True, max_length=255)),
                ("source_file_hash", models.CharField(blank=True, max_length=64)),
                ("source_sheet", models.CharField(blank=True, max_length=128)),
                ("source_row", models.PositiveIntegerField(blank=True, null=True)),
                ("lms_learner_id", models.BigIntegerField(blank=True, db_index=True, null=True)),
                ("first_name", models.CharField(blank=True, max_length=255)),
                ("surname", models.CharField(blank=True, max_length=255)),
                ("full_name", models.CharField(blank=True, db_index=True, max_length=511)),
                ("date_of_birth", models.CharField(blank=True, max_length=32)),
                ("uln", models.CharField(blank=True, db_index=True, max_length=64)),
                ("qualification", models.CharField(blank=True, max_length=255)),
                ("level", models.CharField(blank=True, max_length=64)),
                ("start_date", models.CharField(blank=True, max_length=32)),
                ("practical_end_date", models.CharField(blank=True, max_length=32)),
                ("apprenticeship_end_date", models.CharField(blank=True, max_length=32)),
                ("planned_gateway_date", models.CharField(blank=True, max_length=32)),
                ("planned_epa_date", models.CharField(blank=True, max_length=32)),
                ("raw", models.JSONField(blank=True, default=dict)),
                ("version", models.PositiveIntegerField(default=1)),
                ("updated_by", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "qms_deep_dive_records",
                "ordering": ("full_name", "id"),
            },
        ),
        migrations.AddIndex(model_name="deepdiverecord", index=models.Index(fields=["source_sheet", "source_row"], name="qms_deep_d_source_s_2d7c34_idx")),
        migrations.AddIndex(model_name="deepdiverecord", index=models.Index(fields=["qualification", "level"], name="qms_deep_d_qualifi_47a579_idx")),
    ]

