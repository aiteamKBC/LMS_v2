from django.db import migrations, models
import django.db.models.deletion


def physical_foreign_keys(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    # Coach.coach_calendar_event is a view; reference its physical source.
    for name, column, target in (
        ("review_recon_calendar_fk", "calendar_event_id", '"Learner".coach_calendar_event'),
        ("review_recon_native_fk", "native_review_instance_id", 'curriculum.review_instances'),
        ("review_recon_template_fk", "native_template_id", 'curriculum.review_templates'),
        ("review_recon_source_fk", "source_review_id", '"Learner".reviews'),
        ("review_recon_learner_fk", "learner_id", '"Learner".learners'),
        ("review_recon_approver_fk", "approved_by", 'login."Login_accounts"'),
        ("review_recon_reverser_fk", "reversed_by", 'login."Login_accounts"'),
    ):
        schema_editor.execute(f'ALTER TABLE "Coach".review_source_reconciliation ADD CONSTRAINT {name} '
                              f'FOREIGN KEY ({column}) REFERENCES {target}(id) ON DELETE RESTRICT')


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0024_imported_review_progress_snapshot")]
    operations = [
        migrations.CreateModel(
            name="ReviewSourceReconciliation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("learner_id", models.BigIntegerField()),
                ("calendar_event_id", models.BigIntegerField()),
                ("native_review_instance_id", models.CharField(max_length=128)),
                ("native_template_id", models.CharField(max_length=128)),
                ("native_event_key", models.CharField(max_length=255)),
                ("source_review_id", models.BigIntegerField()),
                ("aptem_review_id", models.CharField(max_length=128)),
                ("family", models.CharField(default="MCM", max_length=16)),
                ("status", models.CharField(default="APPLIED", max_length=16)),
                ("approved_by", models.BigIntegerField()),
                ("approved_at", models.DateTimeField()),
                ("reason", models.TextField()),
                ("reversed_by", models.BigIntegerField(null=True)),
                ("reversed_at", models.DateTimeField(null=True)),
                ("reversal_reason", models.TextField(blank=True)),
                ("calendar_fingerprint", models.CharField(max_length=64)),
                ("overlay_fingerprint", models.CharField(max_length=64)),
                ("overlay_created", models.BooleanField(default=False)),
                ("overlay_previous_status", models.CharField(max_length=32)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("overlay", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="coach_api.importedreviewinstance")),
            ],
            options={
                "db_table": 'Coach"."review_source_reconciliation',
                "constraints": [
                    models.UniqueConstraint(fields=[field], condition=models.Q(status="APPLIED"), name=name)
                    for field, name in (
                        ("calendar_event_id", "review_recon_active_calendar"),
                        ("native_review_instance_id", "review_recon_active_native"),
                        ("source_review_id", "review_recon_active_source"),
                        ("overlay", "review_recon_active_overlay"),
                    )
                ] + [
                    models.CheckConstraint(condition=models.Q(status__in=["APPLIED", "REVERSED"]), name="review_recon_valid_status"),
                    models.CheckConstraint(condition=models.Q(family="MCM"), name="review_recon_mcm_only"),
                ],
            },
        ),
        migrations.RunPython(physical_foreign_keys, migrations.RunPython.noop),
    ]
