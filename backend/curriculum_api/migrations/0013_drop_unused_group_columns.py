from django.db import migrations


GROUP_COLUMNS = {
    'training_plan_ids': {
        'postgres': 'jsonb',
        'sqlite': 'text',
    },
    'status': {
        'postgres': "varchar(32) not null default 'planned'",
        'sqlite': "varchar(32) not null default 'planned'",
    },
    'source_type': {
        'postgres': "varchar(64) not null default 'training_plan'",
        'sqlite': "varchar(64) not null default 'training_plan'",
    },
    'source_id': {
        'postgres': 'varchar(128)',
        'sqlite': 'varchar(128)',
    },
}


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


def drop_group_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for column in GROUP_COLUMNS:
            if column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} drop column "{column}"')


def restore_group_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for column, config in GROUP_COLUMNS.items():
            if column_exists(cursor, connection, column):
                continue
            column_type = config['postgres'] if connection.vendor == 'postgresql' else config['sqlite']
            cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0012_livesession_livesessionartifact_and_more'),
    ]

    operations = [
        migrations.RunPython(drop_group_columns, restore_group_columns),
    ]
