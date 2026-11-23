"""Allow canonical-only attempts; retain all requirements on legacy identities.

Approved locally by the user. Prepared only; does not rewrite any existing row.
The legacy fields cannot describe a commercial Free Course learner, so require
them only on the legacy branch instead of inventing Old LMS groups or identities.
"""
from django.db import migrations

SQL = '''
ALTER TABLE "Learner".subject_activity_attempts
    ALTER COLUMN enrolment_id DROP NOT NULL,
    ALTER COLUMN aptem_id DROP NOT NULL,
    ALTER COLUMN group_id DROP NOT NULL,
    ALTER COLUMN activity_id DROP NOT NULL;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid='"Learner".subject_activity_attempts'::regclass
        AND conname='subject_attempt_legacy_identity_required') THEN
      ALTER TABLE "Learner".subject_activity_attempts ADD CONSTRAINT subject_attempt_legacy_identity_required
        CHECK ((free_component_ref IS NOT NULL AND source_activity_snapshot IS NOT NULL)
          OR (source_activity_fk IS NOT NULL AND enrolment_id IS NOT NULL
            AND aptem_id IS NOT NULL AND group_id IS NOT NULL AND activity_id IS NOT NULL));
    END IF;
END;
$migration$;
CREATE INDEX IF NOT EXISTS subject_attempt_free_learner_component_idx
    ON "Learner".subject_activity_attempts (learner_id,free_component_ref,submitted_at DESC)
    WHERE free_component_ref IS NOT NULL;
'''


def install(apps, schema_editor):
    from importlib import import_module
    from django.db import connections
    database = schema_editor.connection
    if database.vendor != 'postgresql':
        return
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if database.alias != 'default' or identity(database) != identity(connections['enrolment']):
        raise RuntimeError('Verify the default/learner migration database before applying.')
    with database.cursor() as cursor:
        cursor.execute('''SELECT pg_get_constraintdef(oid) FROM pg_constraint
          WHERE conrelid='"Learner".subject_activity_attempts'::regclass
          AND conname='subject_attempt_legacy_identity_required' ''')
        existing = cursor.fetchone()
        expected = 'CHECK (' + SQL.split('CHECK (',1)[1].split(');',1)[0] + ')'
        normalize = lambda value: ''.join(value.lower().replace('(', '').replace(')', '').split())
        if existing and normalize(existing[0]) != normalize(expected):
            raise RuntimeError('Existing legacy attempt identity constraint differs; review before migration.')
    schema_editor.execute("SET LOCAL lock_timeout = '5s'")
    schema_editor.execute(SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api','0029_free_course_historical_bridges')]
    operations = [migrations.RunPython(install, hints={'learner_schema_migration': True})]
