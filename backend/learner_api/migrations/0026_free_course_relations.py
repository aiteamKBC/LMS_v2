"""Match the native free-course relations without discarding historical rows.

Old production completion writers used enrolment IDs; installations which
already have the learner FK (including the architecture branch) use profile
IDs. Translate only the former, after proving every mapping is unambiguous.
An unresolved course/component/learner aborts the migration instead of hiding
it behind an unvalidated constraint or deleting its history.
"""
from importlib import import_module
from django.db import migrations, connections


CONSTRAINTS = (
    ('learner_free_courses_course_fk', 'learner_free_courses', 'free_course_ref', 'curriculum', 'free_courses'),
    ('learner_free_course_progress_component_fk', 'learner_free_course_progress', 'component_ref', 'curriculum', 'free_programme_components'),
    ('learner_free_course_progress_course_fk', 'learner_free_course_progress', 'free_course_ref', 'curriculum', 'free_courses'),
    ('learner_free_course_progress_learner_fk', 'learner_free_course_progress', 'learner_id', 'Learner', 'learners'),
)


def install(apps, schema_editor):
    database = schema_editor.connection
    if database.vendor != 'postgresql':
        return
    if database.alias != 'default':
        raise RuntimeError('Free-course relations must be installed on the verified default database.')
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if identity(database) != identity(connections['enrolment']):
        raise RuntimeError('Verify curriculum and learner connections address the same database before adding relations.')
    with database.cursor() as cursor:
        for namespace, table in {('Learner', 'learner_free_courses'), ('Learner', 'learner_free_course_progress'),
                                 ('Learner', 'learners'), ('curriculum', 'free_courses'), ('curriculum', 'free_programme_components')}:
            cursor.execute('SELECT to_regclass(%s)', [f'"{namespace}"."{table}"'])
            if cursor.fetchone()[0] is None:
                raise RuntimeError('Provision the free-course and learner tables before installing relations.')
        cursor.execute('''LOCK TABLE "Learner".learner_free_courses, "Learner".learner_free_course_progress
            IN SHARE ROW EXCLUSIVE MODE''')
        cursor.execute('''SELECT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conrelid='"Learner".learner_free_course_progress'::regclass
              AND conname='learner_free_course_progress_learner_fk')''')
        if not cursor.fetchone()[0]:
            cursor.execute('''SELECT count(*) FROM "Learner".learner_free_course_progress p
                WHERE (SELECT count(*) FROM "Learner".learners l WHERE l.enrolment_id=p.learner_id)<>1''')
            if cursor.fetchone()[0]:
                raise RuntimeError('Free-course progress has unresolved enrolment identities; reconcile them before migration.')
            cursor.execute('''UPDATE "Learner".learner_free_course_progress p SET learner_id=l.id
                FROM "Learner".learners l WHERE l.enrolment_id=p.learner_id''')
        for name, table, column, namespace, parent in CONSTRAINTS:
            cursor.execute(f'''SELECT count(*) FROM "Learner"."{table}" child
                WHERE child."{column}" IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM "{namespace}"."{parent}" parent WHERE parent.id=child."{column}")''')
            if cursor.fetchone()[0]:
                raise RuntimeError(f'Unresolved {table}.{column}; preserve and reconcile the records before migration.')
            cursor.execute('''SELECT contype='f' AND confrelid=%s::regclass
                AND confupdtype='r' AND confdeltype='r'
                AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname=%s)]::smallint[]
                AND confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=confrelid AND attname='id')]::smallint[]
                FROM pg_constraint WHERE conrelid=%s::regclass AND conname=%s''',
                [f'"{namespace}"."{parent}"', column, f'"Learner"."{table}"', name])
            existing = cursor.fetchone()
            if existing:
                if existing[0] is not True:
                    raise RuntimeError(f'Existing {name} has a different definition; reconcile it before migration.')
                cursor.execute(f'ALTER TABLE "Learner"."{table}" VALIDATE CONSTRAINT "{name}"')
            else:
                cursor.execute(f'''ALTER TABLE "Learner"."{table}" ADD CONSTRAINT "{name}"
                    FOREIGN KEY ("{column}") REFERENCES "{namespace}"."{parent}"(id)
                    ON UPDATE RESTRICT ON DELETE RESTRICT''')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0025_legacy_quiz_retake_grants'),
                    ('curriculum_api', '0081_merge_free_courses_qr_attendance')]
    operations = [migrations.RunPython(install, hints={'learner_schema_migration': True})]
