"""State for the externally managed reflection-skip progress column."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0011_inside_working_hours_declaration')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[],
        state_operations=[
            migrations.AddField(
                'learnerprogressentry',
                'reflection_skipped',
                models.BooleanField(default=False),
            ),
        ],
    )]
