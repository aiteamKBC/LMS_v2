"""Expose the canonical progress soft-delete column to the unmanaged model."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0019_quiz_grade_corrections")]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[],
        state_operations=[migrations.AddField(
            model_name="learnerprogressentry",
            name="deleted_at",
            field=models.DateTimeField(null=True, blank=True),
        )],
    )]
