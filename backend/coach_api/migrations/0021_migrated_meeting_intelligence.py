from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0020_migrated_review_completion")]

    operations = [
        migrations.AddField(
            model_name="importedreviewinstance",
            name="meeting_intelligence",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
