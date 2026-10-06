"""State for externally managed progress columns; apply with the schema command."""
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0010_learnerfreecourse_learnerfreecourseprogress')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[],
        state_operations=[
            migrations.AddField('learnerprogressentry', 'inside_working_hours_confirmed', models.BooleanField(default=False)),
            migrations.AddField('learnerprogressentry', 'inside_working_hours_confirmed_at', models.DateTimeField(null=True, blank=True)),
        ],
    )]
