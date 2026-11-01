"""Keep the assigned module tutor as a historical lecture delivery label."""
from django.db import migrations, models


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Isolated suites do not create the unmanaged Feedback schema.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Lecture tutor snapshot requires the canonical PostgreSQL default database.')
    schema_editor.execute('''ALTER TABLE "Feedback".feedback_deliveries
        ADD COLUMN IF NOT EXISTS tutor_name varchar(255) NOT NULL DEFAULT '';''')


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0009_feedback_lecture_question_override')]
    operations = [
        migrations.AddField(
            model_name='feedbackdelivery',
            name='tutor_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        # Preserve captured names if a migration is rolled back.
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
