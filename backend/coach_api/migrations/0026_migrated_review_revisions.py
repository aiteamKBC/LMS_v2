from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0025_review_source_reconciliation")]

    operations = [
        migrations.CreateModel(
            name="MigratedReviewRevision",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("number", models.PositiveIntegerField()),
                ("snapshot", models.JSONField()),
                ("pdf_bytes", models.BinaryField(null=True)),
                ("pdf_sha256", models.CharField(blank=True, max_length=64)),
                ("reason_code", models.CharField(max_length=32)),
                ("note", models.TextField(blank=True)),
                ("actor_account_id", models.BigIntegerField()),
                ("actor_email", models.EmailField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("overlay", models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT, related_name="archived_revisions",
                    to="coach_api.importedreviewinstance",
                )),
            ],
            options={
                "db_table": 'Coach"."coach_migrated_review_revision',
                "constraints": [
                    models.UniqueConstraint(fields=("overlay", "number"), name="coach_migrated_revision_unique"),
                    models.CheckConstraint(condition=models.Q(number__gte=1), name="coach_migrated_revision_positive"),
                ],
            },
        ),
    ]
