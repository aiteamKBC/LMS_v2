"""Add timing checkpoints without rewriting historical learner progress."""
from django.db import migrations, models, connections


def _database_identity(connection):
    config = connection.settings_dict
    # Django's two URL parsers represent PostgreSQL's default port as either
    # an empty value or 5432. Both address the same database.
    default_port = '5432' if connection.vendor == 'postgresql' else ''
    return tuple(str(config.get(key) or '') for key in ('ENGINE', 'NAME', 'HOST', 'USER')) + (
        str(config.get('PORT') or default_port),
    )


def install(apps, schema_editor):
    primary = schema_editor.connection
    learner = connections['enrolment']
    if primary.alias != 'default':
        raise RuntimeError('Install timing drafts through the canonical default migration connection.')
    if _database_identity(primary) != _database_identity(learner):
        raise RuntimeError('Verify default and enrolment identify the same database before installing timing drafts.')
    schema_editor.create_model(apps.get_model('learner_api', 'ActivityTimingDraft'))


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0023_merge_progress_transfer_support')]
    operations = [
        migrations.CreateModel(name='ActivityTimingDraft', fields=[
            ('session_id', models.CharField(primary_key=True, max_length=64, serialize=False)),
            ('token_hash', models.CharField(max_length=64)),
            ('started_at', models.DateTimeField()),
            ('windows', models.JSONField(default=list)),
            ('elapsed_seconds', models.PositiveIntegerField(default=0)),
            ('updated_at', models.DateTimeField()),
        ], options={'managed': False, 'db_table': 'learner_activity_timing_drafts'}),
        migrations.RunPython(install, hints={'learner_schema_migration': True}),
    ]
