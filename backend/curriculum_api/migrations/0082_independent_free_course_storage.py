"""Cut over free-course storage after learner relationships have been verified.

Release with the native-storage reader/writer code, in a maintenance window.
Take a database restore point first. No reverse rewrite is provided: restoring
the previous application requires restoring that database snapshot as well.
"""
from django.db import migrations


def install(apps, schema_editor):
    from curriculum_api.free_course_native_schema import detach
    database = schema_editor.connection
    if database.vendor != 'postgresql':
        return
    if database.alias != 'default':
        raise RuntimeError('Native course cutover must run on the verified default database.')
    detach(database)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0081_merge_free_courses_qr_attendance'),
                    ('learner_api', '0026_free_course_relations')]
    operations = [migrations.RunPython(install)]
