import uuid

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="ReadModel",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model_key", models.CharField(max_length=120)),
                ("scope_type", models.CharField(max_length=60)),
                ("scope_id", models.CharField(max_length=255)),
                ("schema_version", models.PositiveSmallIntegerField(default=1)),
                ("payload", models.JSONField(default=dict)),
                ("source_revision", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(default="ready", max_length=16)),
                ("refreshed_at", models.DateTimeField(auto_now=True)),
                ("expires_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "platform_read_models"},
        ),
        migrations.CreateModel(
            name="ReadModelEvent",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("event_type", models.CharField(max_length=120)),
                ("model_key", models.CharField(max_length=120)),
                ("scope_type", models.CharField(max_length=60)),
                ("scope_id", models.CharField(max_length=255)),
                ("payload", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(default="pending", max_length=16)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("available_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("locked_at", models.DateTimeField(blank=True, null=True)),
                ("locked_by", models.CharField(blank=True, max_length=120)),
                ("last_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "platform_read_model_outbox"},
        ),
        migrations.CreateModel(
            name="PerformanceSample",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("run_id", models.CharField(blank=True, max_length=64)),
                ("subject_type", models.CharField(blank=True, max_length=24)),
                ("role", models.CharField(blank=True, max_length=32)),
                ("workspace", models.CharField(blank=True, max_length=48)),
                ("route_path", models.CharField(max_length=300)),
                ("page_key", models.CharField(blank=True, max_length=120)),
                ("page_label", models.CharField(blank=True, max_length=160)),
                ("cold_navigation", models.BooleanField(default=False)),
                ("page_ready_ms", models.FloatField()),
                ("request_count", models.PositiveSmallIntegerField(default=0)),
                ("duplicate_get_count", models.PositiveSmallIntegerField(default=0)),
                ("failed_request_count", models.PositiveSmallIntegerField(default=0)),
                ("total_api_ms", models.FloatField(default=0)),
                ("max_api_ms", models.FloatField(default=0)),
                ("total_db_ms", models.FloatField(blank=True, null=True)),
                ("total_query_count", models.PositiveIntegerField(blank=True, null=True)),
                ("request_details", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"db_table": "platform_performance_samples"},
        ),
        migrations.AddConstraint(
            model_name="readmodel",
            constraint=models.UniqueConstraint(
                fields=("model_key", "scope_type", "scope_id"),
                name="platform_read_model_scope_uniq",
            ),
        ),
        migrations.AddIndex(
            model_name="readmodelevent",
            index=models.Index(fields=["status", "available_at", "created_at"], name="platform_outbox_claim_idx"),
        ),
        migrations.AddIndex(
            model_name="readmodelevent",
            index=models.Index(fields=["model_key", "scope_type", "scope_id", "status"], name="platform_outbox_scope_idx"),
        ),
        migrations.AddIndex(
            model_name="performancesample",
            index=models.Index(fields=["-created_at"], name="platform_perf_created_idx"),
        ),
        migrations.AddIndex(
            model_name="performancesample",
            index=models.Index(fields=["workspace", "route_path", "-created_at"], name="platform_perf_route_idx"),
        ),
    ]
