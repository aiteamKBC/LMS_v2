from django.db import migrations


def table_name(connection):
    return 'curriculum."modules"' if connection.vendor == 'postgresql' else '"modules"'


def table_exists(cursor, connection):
    if connection.vendor == 'postgresql':
        cursor.execute("select to_regclass('curriculum.modules')")
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name='modules' limit 1")
    return bool(cursor.fetchone())


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
            ['curriculum', 'modules', column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_module_coach_name(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if table_exists(cursor, connection) and column_exists(cursor, connection, 'coach_name'):
            cursor.execute(f'alter table {table_name(connection)} drop column "coach_name"')


def restore_module_coach_name(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if table_exists(cursor, connection) and not column_exists(cursor, connection, 'coach_name'):
            cursor.execute(f'alter table {table_name(connection)} add column "coach_name" varchar(255)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0020_drop_ksb_profile_scope_columns'),
    ]

    operations = [
        migrations.RunPython(drop_module_coach_name, restore_module_coach_name),
    ]

