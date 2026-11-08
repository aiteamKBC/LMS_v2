"""Scoped, single-use permission; historical quiz results stay untouched."""
from importlib import import_module
from django.db import migrations, connections

SQL = '''
CREATE TABLE IF NOT EXISTS "Learner".legacy_quiz_retake_grants (
    id uuid PRIMARY KEY,
    enrolment_id bigint NOT NULL REFERENCES enrolment."Created_users"(id),
    aptem_id bigint NOT NULL,
    group_id bigint NOT NULL,
    quiz_id bigint NOT NULL,
    ticket_ref text NOT NULL,
    reason text NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_attempt_id uuid REFERENCES "Learner".subject_activity_attempts(id),
    used_at timestamptz,
    UNIQUE(enrolment_id,group_id,quiz_id,ticket_ref),
    CHECK ((used_attempt_id IS NULL) = (used_at IS NULL))
);
'''


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if connection.alias != 'default' or identity(connection) != identity(connections['enrolment']):
        raise RuntimeError('Verify default and enrolment target the same database before installing quiz retakes.')
    schema_editor.execute(SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0024_activity_timing_drafts')]
    operations = [migrations.RunPython(install, hints={'learner_schema_migration': True})]
