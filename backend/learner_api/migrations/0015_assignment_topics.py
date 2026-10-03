"""Keep independent topic submissions with their original component identity."""
from django.db import migrations

STATEMENTS = (
    '''ALTER TABLE "Learner".learning_reflection_submissions
       ADD COLUMN IF NOT EXISTS assignment_topic_id varchar(1) NOT NULL DEFAULT ''
       CHECK (assignment_topic_id IN ('', '1', '2', '3'))''',
    '''CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_reflections_topic
       ON "Learner".learning_reflection_submissions
       (learner_kind, learner_id, activity_type, activity_id, assignment_topic_id)''',
    'DROP INDEX IF EXISTS "Learner".uq_learning_reflections_activity',
)


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('SELECT to_regclass(%s)', ['"Learner".learning_reflection_submissions'])
        if cursor.fetchone()[0] is None:
            return
        for statement in STATEMENTS:
            cursor.execute(statement)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0014_legacy_lms_identity_aliases')]
    operations = [migrations.RunPython(apply_schema, hints={'learner_schema_migration': True})]
