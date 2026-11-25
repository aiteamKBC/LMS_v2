"""Baseline canonical ledger attribution without replaying historical learner data.

Already-installed Development columns/constraints are verified, never rewritten.
An installation with legacy bridge records requires its own reviewed recovery;
this migration neither reads identities out of JSON nor recreates retired tables.
"""
from importlib import import_module
from django.db import connections, migrations


def install(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != 'postgresql':
        return
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if db.alias != 'default' or identity(db) != identity(connections['enrolment']):
        raise RuntimeError('Use the verified shared curriculum/learner migration target.')
    with db.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        for name in ('free_course_hours_migration', 'free_course_hours_migration_additional', 'free_course_hours_migration_remaining'):
            cursor.execute('SELECT to_regclass(%s)', ['"Learner".' + name])
            if cursor.fetchone()[0]:
                raise RuntimeError('Legacy bridge remains: complete reviewed canonical recovery before this baseline.')
        cursor.execute('''ALTER TABLE "Learner".learner_progress_entries
            ADD COLUMN IF NOT EXISTS free_course_ref varchar(128),
            ADD COLUMN IF NOT EXISTS free_component_ref varchar(128)''')
        cursor.execute('''SELECT count(*) FROM "Learner".learner_progress_entries p
            LEFT JOIN curriculum.free_programme_components c ON c.id=p.free_component_ref
            LEFT JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
            LEFT JOIN curriculum.free_courses f ON f.id=p.free_course_ref
            WHERE (p.free_course_ref IS NULL)<>(p.free_component_ref IS NULL)
               OR (p.free_component_ref IS NOT NULL AND
                   (c.id IS NULL OR f.id IS NULL OR w.course_id IS DISTINCT FROM p.free_course_ref))''')
        if cursor.fetchone()[0]:
            raise RuntimeError('Canonical identity integrity failure; no data rewritten.')
        for name, definition in (
            ('lpe_free_identity_both_or_neither', 'CHECK ((free_component_ref IS NULL) = (free_course_ref IS NULL))'),
            ('lpe_free_component_fk', 'FOREIGN KEY (free_component_ref) REFERENCES curriculum.free_programme_components(id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
            ('lpe_free_course_fk', 'FOREIGN KEY (free_course_ref) REFERENCES curriculum.free_courses(id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
        ):
            cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
                WHERE conrelid='"Learner".learner_progress_entries'::regclass AND conname=%s''', [name])
            row = cursor.fetchone()
            normalize = lambda value: ''.join(value.lower().replace('(', '').replace(')', '').split())
            if row and (normalize(row[0]) != normalize(definition) or not row[1]):
                raise RuntimeError('Canonical identity constraint differs: ' + name)
            if not row:
                cursor.execute(f'ALTER TABLE "Learner".learner_progress_entries ADD CONSTRAINT {name} {definition}')
        cursor.execute('''CREATE INDEX IF NOT EXISTS lpe_free_component_ref_idx
            ON "Learner".learner_progress_entries(free_component_ref) WHERE free_component_ref IS NOT NULL''')
        cursor.execute('''CREATE INDEX IF NOT EXISTS lpe_free_course_owner_idx
            ON "Learner".learner_progress_entries(free_course_ref,learner_id) WHERE free_course_ref IS NOT NULL''')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0032_canonical_ksb_state')]
    operations = [migrations.RunPython(install, hints={'learner_schema': True})]
