"""Allow several source accounts, while retaining unique source ownership."""
from django.db import migrations


STATEMENTS = (
    '''CREATE INDEX IF NOT EXISTS learner_external_identities_learner_idx
       ON "Learner".learner_external_identities (learner_id, source_system)
       WHERE deleted_at IS NULL''',
    'DROP INDEX IF EXISTS "Learner".learner_external_identities_learner_uniq',
)


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('SELECT to_regclass(%s)', ['"Learner".learner_external_identities'])
        if cursor.fetchone()[0] is None:
            return  # Externally managed canonical tables are not present here.
        for statement in STATEMENTS:
            cursor.execute(statement)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0013_declared_completion')]
    operations = [migrations.RunPython(
        apply_schema, hints={'learner_schema_migration': True},
    )]
