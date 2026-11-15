"""Store first-session week boundaries without changing existing schedules."""
from django.db import migrations


def add_week_starts_on(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('alter table curriculum.modules add column if not exists week_starts_on varchar(9)')
            cursor.execute("select to_regclass('curriculum.learning_courses')")
            if cursor.fetchone()[0] is not None:
                from curriculum_api.free_course_native_schema import create_read_views
                create_read_views(connection, tables={'modules'})
        else:
            cursor.execute('pragma table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'week_starts_on' not in columns:
                cursor.execute('alter table modules add column week_starts_on varchar(9)')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0088_module_schedule_mode')]
    # Retain the additive field when rolling back application code.
    operations = [migrations.RunPython(add_week_starts_on, migrations.RunPython.noop)]
