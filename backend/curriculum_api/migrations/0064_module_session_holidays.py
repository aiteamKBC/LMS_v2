from django.db import migrations


def add_session_holidays(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        if schema_editor.connection.vendor == 'postgresql':
            cursor.execute('alter table curriculum.modules add column if not exists session_holidays jsonb')
        else:
            cursor.execute('pragma table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'session_holidays' not in columns:
                cursor.execute('alter table modules add column session_holidays text')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0063_module_weekly_schedule')]
    operations = [migrations.RunPython(add_session_holidays, migrations.RunPython.noop)]
