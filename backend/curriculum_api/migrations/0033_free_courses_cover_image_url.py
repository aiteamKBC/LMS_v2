from django.db import migrations


TABLE = 'free_courses'


def table_name(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
    cursor.execute(
        '''
        select 1
        from information_schema.columns
        where table_schema = %s
          and table_name = %s
          and column_name = %s
        limit 1
        ''',
        ['curriculum', table, column],
    )
    return bool(cursor.fetchone())


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, TABLE):
            return
        if not column_exists(cursor, TABLE, 'cover_image_url'):
            cursor.execute(f'alter table {table_name(TABLE)} add column cover_image_url text')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0032_drop_free_courses_status_color'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
