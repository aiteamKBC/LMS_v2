"""Keep public lecture QR claims separate from attendance evidence."""
from django.db import migrations, models


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Disposable test databases do not create the unmanaged schema.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Public lecture feedback requires the canonical PostgreSQL default database.')
    schema_editor.execute('''ALTER TABLE "Feedback".feedback_delivery_recipients
        ADD COLUMN IF NOT EXISTS public_claimed_at timestamptz NULL;''')


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0010_employer_review_feedback')]
    operations = [
        migrations.AddField(
            model_name='feedbackdeliveryrecipient', name='public_claimed_at',
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
