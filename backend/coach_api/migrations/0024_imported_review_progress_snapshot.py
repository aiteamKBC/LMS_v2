from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0023_remove_legacy_migrated_template_index")]

    operations = [
        migrations.AddField(
            model_name="importedreviewinstance",
            name="progress_snapshot",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
