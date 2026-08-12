from django.db import migrations


TABLE = 'free_courses'
COLUMNS = ('status', 'color')


def table_name(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, TABLE):
            return
        for column in COLUMNS:
            cursor.execute(f'alter table {table_name(TABLE)} drop column if exists {column}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0031_free_courses_course_name_global'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
