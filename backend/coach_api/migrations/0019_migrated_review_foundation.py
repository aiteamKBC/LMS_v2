from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0018_coachattendancesourceadjustment")]

    operations = [
        migrations.CreateModel(
            name="MigratedReviewTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("programme_key", models.CharField(max_length=255)),
                ("review_family", models.CharField(choices=[("MCM", "Monthly Coaching Meeting"), ("PR", "Progress Review")], max_length=3)),
                ("name", models.CharField(max_length=255)),
                ("definition_json", models.JSONField(default=dict)),
                ("is_active", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": 'Coach"."coach_migrated_review_template'},
        ),
        migrations.AddConstraint(
            model_name="migratedreviewtemplate",
            constraint=models.UniqueConstraint(
                fields=("programme_key", "review_family"), condition=models.Q(is_active=True),
                name="coach_migrated_template_one_active",
            ),
        ),
        migrations.AddConstraint(
            model_name="migratedreviewtemplate",
            constraint=models.CheckConstraint(
                condition=models.Q(review_family__in=["MCM", "PR"]),
                name="coach_migrated_template_family_valid",
            ),
        ),
        migrations.AddField(
            model_name="importedreviewinstance", name="source_review_id",
            field=models.BigIntegerField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="importedreviewinstance", name="migrated_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=models.PROTECT,
                                    related_name="review_overlays", to="coach_api.migratedreviewtemplate"),
        ),
        migrations.AddField(
            model_name="importedreviewinstance", name="template_snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name="importedreviewinstance", name="status",
            field=models.CharField(choices=[
                ("not-scheduled", "Not Scheduled"), ("scheduled", "Scheduled"),
                ("in-progress", "In Progress"), ("awaiting-signature", "Awaiting Signature"),
                ("completed", "Completed"),
            ], db_index=True, default="in-progress", max_length=32),
        ),
        migrations.RemoveConstraint(model_name="importedreviewinstance", name="coach_imported_review_status_valid"),
        migrations.AddConstraint(
            model_name="importedreviewinstance",
            constraint=models.CheckConstraint(
                condition=models.Q(status__in=[
                    "not-scheduled", "scheduled", "in-progress", "awaiting-signature", "completed",
                ]), name="coach_imported_review_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="importedreviewinstance",
            constraint=models.UniqueConstraint(
                Lower("owner_email"), models.F("event_key"),
                name="coach_imported_review_owner_event_ci_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="importedreviewinstance",
            constraint=models.UniqueConstraint(
                fields=("source_review_id",), condition=models.Q(source_review_id__isnull=False),
                name="coach_imported_review_source_unique",
            ),
        ),
        migrations.RunSQL(
            sql='ALTER TABLE "Coach"."coach_imported_review_instance" ADD CONSTRAINT '
                'coach_imported_review_source_fk FOREIGN KEY (source_review_id) '
                'REFERENCES "Learner".reviews(id) NOT VALID',
            reverse_sql='ALTER TABLE "Coach"."coach_imported_review_instance" '
                        'DROP CONSTRAINT IF EXISTS coach_imported_review_source_fk',
        ),
    ]
