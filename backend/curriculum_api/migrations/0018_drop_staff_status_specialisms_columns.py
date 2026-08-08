from django.db import migrations


STAFF_TABLES = ('tutors', 'coaches')
STAFF_COLUMNS = {
    'status': {
        'postgres': "varchar(32) not null default 'active'",
        'sqlite': "varchar(32) not null default 'active'",
    },
    'specialisms': {
        'postgres': 'jsonb',
        'sqlite': 'text',
    },
}


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


def drop_staff_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for table in STAFF_TABLES:
            cursor.execute(f'drop index if exists curriculum_{table}_status_idx')
            for column in STAFF_COLUMNS:
                if column_exists(cursor, connection, table, column):
                    cursor.execute(f'alter table {table_name(connection, table)} drop column "{column}"')


def restore_staff_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for table in STAFF_TABLES:
            for column, config in STAFF_COLUMNS.items():
                if column_exists(cursor, connection, table, column):
                    continue
                column_type = config['postgres'] if connection.vendor == 'postgresql' else config['sqlite']
                cursor.execute(f'alter table {table_name(connection, table)} add column "{column}" {column_type}')
            cursor.execute(f'create index if not exists curriculum_{table}_status_idx on {table_name(connection, table)} (status)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0017_ensure_staff_profiles_from_curriculum_assignments'),
    ]

    operations = [
        migrations.RunPython(drop_staff_columns, restore_staff_columns),
    ]
