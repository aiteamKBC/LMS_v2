from django.db import migrations


def table_name(connection):
    return 'curriculum."groups"' if connection.vendor == 'postgresql' else '"groups"'


def table_exists(cursor, connection):
    if connection.vendor == 'postgresql':
        cursor.execute("select to_regclass('curriculum.groups')")
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name='groups' limit 1")
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
            ['curriculum', 'groups', column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_group_training_plan_ids(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if table_exists(cursor, connection) and column_exists(cursor, connection, 'training_plan_ids'):
            cursor.execute(f'alter table {table_name(connection)} drop column "training_plan_ids"')


def restore_group_training_plan_ids(apps, schema_editor):
    connection = schema_editor.connection
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if table_exists(cursor, connection) and not column_exists(cursor, connection, 'training_plan_ids'):
            cursor.execute(f'alter table {table_name(connection)} add column "training_plan_ids" {json_type}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0024_split_group_schedule_drop_group_dates'),
    ]

    operations = [
        migrations.RunPython(drop_group_training_plan_ids, restore_group_training_plan_ids),
    ]

