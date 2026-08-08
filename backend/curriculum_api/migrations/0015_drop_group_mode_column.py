from django.db import migrations


def table_name(connection):
    return 'curriculum."groups"' if connection.vendor == 'postgresql' else '"groups"'


def column_exists(cursor, connection, column):
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
            ['curriculum', 'groups', column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_group_mode(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if column_exists(cursor, connection, 'mode'):
            cursor.execute(f'alter table {table_name(connection)} drop column "mode"')


def restore_group_mode(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not column_exists(cursor, connection, 'mode'):
            cursor.execute(f'alter table {table_name(connection)} add column "mode" varchar(64) not null default \'Live\'')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0014_drop_unused_module_columns'),
    ]

    operations = [
        migrations.RunPython(drop_group_mode, restore_group_mode),
    ]
