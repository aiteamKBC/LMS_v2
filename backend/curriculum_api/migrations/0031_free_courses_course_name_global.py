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

        if column_exists(cursor, TABLE, 'title') and not column_exists(cursor, TABLE, 'course_name'):
            cursor.execute(f'alter table {table_name(TABLE)} rename column title to course_name')
        elif not column_exists(cursor, TABLE, 'course_name'):
            cursor.execute(f"alter table {table_name(TABLE)} add column course_name varchar(500) not null default ''")

        cursor.execute(f"update {table_name(TABLE)} set course_name = coalesce(nullif(course_name, ''), 'Untitled free course')")
        cursor.execute(f'alter table {table_name(TABLE)} alter column course_name set not null')
        cursor.execute(f'alter table {table_name(TABLE)} drop column if exists programme_id')
        cursor.execute(f'alter table {table_name(TABLE)} drop column if exists programme_name')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0030_free_courses_week_link_and_ids'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
