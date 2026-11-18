"""Record partial ticket-sync failures without resending accepted emails."""
from django.db import migrations, models


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Feedback email history requires the canonical PostgreSQL default database.')
    schema_editor.execute('''
        SET LOCAL lock_timeout = '5s';
        ALTER TABLE "Feedback".feedback_response_emails
            ADD COLUMN IF NOT EXISTS ticket_close_status varchar(20) NOT NULL DEFAULT 'not_required'
                CHECK (ticket_close_status IN ('not_required', 'pending', 'closed', 'failed')),
            ADD COLUMN IF NOT EXISTS ticket_close_error text NOT NULL DEFAULT '';
    ''', params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0013_feedback_response_emails')]
    operations = [
        migrations.AddField(model_name='feedbackresponseemail', name='ticket_close_status',
                            field=models.CharField(default='not_required', max_length=20)),
        migrations.AddField(model_name='feedbackresponseemail', name='ticket_close_error',
                            field=models.TextField(blank=True, default='')),
        # Historical correspondence and close results survive rollback.
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
