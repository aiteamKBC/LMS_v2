"""Record attempt identities; retired recovery bridges must never be recreated."""
from importlib import import_module
from django.db import migrations, connections


def install(apps, schema_editor):
    database = schema_editor.connection
    if database.vendor != 'postgresql':
        return
    if database.alias != 'default':
        raise RuntimeError('Use the verified default schema migration connection.')
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if identity(database) != identity(connections['enrolment']):
        raise RuntimeError('Curriculum and learner database identities must match.')
    schema_editor.execute("SET LOCAL lock_timeout = '5s'")
    # Recovery identity now lives on learner_progress_entries. Replaying this
    # migration must neither recreate the retired bridge tables nor infer data.
    schema_editor.execute('''ALTER TABLE "Learner".subject_activity_attempts
        ADD COLUMN IF NOT EXISTS free_component_ref varchar,
        ADD COLUMN IF NOT EXISTS source_activity_snapshot jsonb,
        ALTER COLUMN source_activity_fk DROP NOT NULL''')
    constraints = (
        ('subject_attempt_free_component_fk', '''FOREIGN KEY (free_component_ref)
          REFERENCES curriculum.free_programme_components(id) ON DELETE RESTRICT'''),
        ('subject_attempt_identity_required', '''CHECK (source_activity_fk IS NOT NULL OR
          (free_component_ref IS NOT NULL AND source_activity_snapshot IS NOT NULL))'''),
    )
    with database.cursor() as cursor:
        for name, definition in constraints:
            cursor.execute('''SELECT pg_get_constraintdef(oid) FROM pg_constraint
              WHERE conrelid='"Learner".subject_activity_attempts'::regclass AND conname=%s''', [name])
            existing = cursor.fetchone()
            if existing:
                # Compare tokens without PostgreSQL's redundant check parentheses.
                normalize = lambda value: ''.join(value.lower().replace('(', '').replace(')', '').split())
                if normalize(existing[0]) != normalize(definition):
                    raise RuntimeError(f'Unexpected existing constraint: {name}')
            else:
                schema_editor.execute(f'ALTER TABLE "Learner".subject_activity_attempts ADD CONSTRAINT {name} {definition}')


class Migration(migrations.Migration):
    dependencies = [('learner_api','0028_source_lms_alias_profile_aptem_integrity'),
                    ('curriculum_api','0087_free_course_compatible_fields')]
    # Deliberately irreversible: rollback must never drop historical evidence.
    operations = [migrations.RunPython(install, hints={'learner_schema_migration': True})]
