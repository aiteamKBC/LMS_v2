"""Keep existing catalogue courses Free; allow independently authored Apprentices courses."""
from django.db import migrations


def provision(apps, schema_editor):
    connection = schema_editor.connection
    pg = connection.vendor == 'postgresql'
    table = 'curriculum.free_courses' if pg else 'free_courses'
    with connection.cursor() as cursor:
        if pg:
            cursor.execute('select to_regclass(%s)', [table])
            if not cursor.fetchone()[0]:
                return
            cursor.execute('''select column_name from information_schema.columns
                              where table_schema = 'curriculum' and table_name = 'free_courses' ''')
            columns = {row[0] for row in cursor.fetchall()}
        else:
            cursor.execute('pragma table_info(free_courses)')
            columns = {row[1] for row in cursor.fetchall()}
            if not columns:
                return
        if 'course_type' not in columns:
            cursor.execute(f'''alter table {table} add column course_type varchar(16)
                               not null default 'free' check (course_type in ('free', 'apprentices'))''')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0071_attendance_identity_rules')]
    operations = [migrations.RunPython(provision, migrations.RunPython.noop)]
