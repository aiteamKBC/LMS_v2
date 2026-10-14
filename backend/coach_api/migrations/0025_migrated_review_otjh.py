from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0024_imported_review_progress_snapshot")]

    operations = [
        migrations.AddField("migratedreviewtemplate", "expected_otjh",
                            models.DecimalField(max_digits=8, decimal_places=2, default=0)),
        migrations.AddField("migratedreviewtemplate", "counts_towards_otjh",
                            models.BooleanField(default=False)),
        migrations.AddConstraint("migratedreviewtemplate", models.CheckConstraint(
            condition=models.Q(expected_otjh__gte=0), name="coach_migrated_otjh_nonnegative")),
    ]
