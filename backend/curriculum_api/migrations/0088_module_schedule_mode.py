"""Keep explicit module schedules separate from inherited Group schedules."""
from django.db import migrations


def add_schedule_mode(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute("alter table curriculum.modules add column if not exists schedule_mode varchar(16) not null default 'group'")
        else:
            cursor.execute('pragma table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'schedule_mode' not in columns:
                cursor.execute("alter table modules add column schedule_mode varchar(16) not null default 'group'")


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0087_free_course_compatible_fields')]
    # Older versions ignore the additive column; retain explicit schedules on rollback.
    operations = [migrations.RunPython(add_schedule_mode, migrations.RunPython.noop)]
