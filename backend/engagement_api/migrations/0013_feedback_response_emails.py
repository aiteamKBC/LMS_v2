"""Preserve outbound feedback correspondence and retry identities."""
import uuid

from django.db import migrations, models
import django.db.models.deletion


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Isolated tests provision these unmanaged tables explicitly.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Feedback email history requires the canonical PostgreSQL default database.')
    schema_editor.execute('''
        SET LOCAL lock_timeout = '5s';
        CREATE TABLE IF NOT EXISTS "Feedback".feedback_response_emails (
            id uuid PRIMARY KEY,
            response_id bigint NOT NULL REFERENCES "Feedback".feedback_responses(id) ON DELETE RESTRICT,
            recipient_email varchar(320) NOT NULL,
            sender_email varchar(320) NOT NULL,
            subject varchar(255) NOT NULL,
            body text NOT NULL,
            actor_account_id bigint NOT NULL,
            actor_name varchar(255) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'sending'
                CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
            error text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            sent_at timestamptz NULL
        );
        CREATE INDEX IF NOT EXISTS feedback_response_emails_response_idx
            ON "Feedback".feedback_response_emails (response_id, created_at DESC);
    ''', params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0012_epa_review_feedback')]
    operations = [
        migrations.CreateModel(
            name='FeedbackResponseEmail',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('recipient_email', models.EmailField(max_length=320)),
                ('sender_email', models.EmailField(max_length=320)),
                ('subject', models.CharField(max_length=255)),
                ('body', models.TextField()),
                ('actor_account_id', models.BigIntegerField()),
                ('actor_name', models.CharField(max_length=255)),
                ('status', models.CharField(default='sending', max_length=20)),
                ('error', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('response', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,
                    related_name='emails', to='engagement_api.feedbackresponse')),
            ],
            options={'db_table': 'Feedback"."feedback_response_emails', 'managed': False},
        ),
        # Preserve correspondence on rollback rather than deleting audit history.
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
