from django.db import migrations


TABLE = 'free_courses'


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
        cursor.execute(f'alter table {table_name(TABLE)} drop column if exists week_id')
        cursor.execute(f'alter table {table_name(TABLE)} drop column if exists week_number')
        cursor.execute(f'alter table {table_name(TABLE)} drop column if exists week_title')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0035_repair_free_course_week_split'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
