"""State for externally managed progress columns; apply with the schema command."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0012_progress_reflection_skipped')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[],
        state_operations=[
            migrations.AddField('learnerprogressentry', 'declared_completed_at', models.DateTimeField(null=True, blank=True)),
            migrations.AddField('learnerprogressentry', 'submission_validation_reason', models.CharField(max_length=32, blank=True, default='')),
        ],
    )]
