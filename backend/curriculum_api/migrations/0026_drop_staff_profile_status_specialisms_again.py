from django.db import migrations


STAFF_TABLES = ('tutors', 'coaches')
STAFF_COLUMNS = ('status', 'specialisms')


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def column_exists(cursor, connection, table, column):
    if connection.vendor == 'postgresql':
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
    cursor.execute(f'pragma table_info({table_name(connection, table)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_staff_profile_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for table in STAFF_TABLES:
            cursor.execute(f'drop index if exists curriculum_{table}_status_idx')
            for column in STAFF_COLUMNS:
                if column_exists(cursor, connection, table, column):
                    cursor.execute(f'alter table {table_name(connection, table)} drop column "{column}"')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0025_drop_group_training_plan_ids'),
    ]

    operations = [
        migrations.RunPython(drop_staff_profile_columns, migrations.RunPython.noop),
    ]
