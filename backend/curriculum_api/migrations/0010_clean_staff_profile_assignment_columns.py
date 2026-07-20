from django.db import migrations


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def column_exists(cursor, connection, table, column):
    if connection.vendor == 'postgresql':
        cursor.execute(
            'select 1 from information_schema.columns where table_schema = %s and table_name = %s and column_name = %s limit 1',
            ['curriculum', table, column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection, table)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_column_if_exists(cursor, connection, table, column):
    if not column_exists(cursor, connection, table, column):
        return
    if connection.vendor == 'postgresql':
        cursor.execute(f'alter table {table_name(connection, table)} drop column if exists {column}')
    else:
        cursor.execute(f'alter table {table_name(connection, table)} drop column {column}')


def clean_assignment_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        drop_column_if_exists(cursor, connection, 'coaches', 'assigned_module_ids')
        drop_column_if_exists(cursor, connection, 'tutors', 'assigned_group_ids')


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0009_staff_profile_group_assignments'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(clean_assignment_columns, noop_reverse),
            ],
            state_operations=[
                migrations.RemoveField(
                    model_name='coach',
                    name='assigned_module_ids',
                ),
            ],
        ),
    ]
