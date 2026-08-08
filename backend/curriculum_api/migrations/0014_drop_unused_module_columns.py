from django.db import migrations


MODULE_COLUMNS = {
    'status': {
        'postgres': "varchar(32) not null default 'draft'",
        'sqlite': "varchar(32) not null default 'draft'",
    },
    'source_type': {
        'postgres': 'varchar(64)',
        'sqlite': 'varchar(64)',
    },
    'source_id': {
        'postgres': 'varchar(128)',
        'sqlite': 'varchar(128)',
    },
    'imported_from_training_plan_id': {
        'postgres': 'varchar(128)',
        'sqlite': 'varchar(128)',
    },
}


def table_name(connection):
    return 'curriculum."modules"' if connection.vendor == 'postgresql' else '"modules"'


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


def drop_module_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for column in MODULE_COLUMNS:
            if column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} drop column "{column}"')


def restore_module_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for column, config in MODULE_COLUMNS.items():
            if column_exists(cursor, connection, column):
                continue
            column_type = config['postgres'] if connection.vendor == 'postgresql' else config['sqlite']
            cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0013_drop_unused_group_columns'),
    ]

    operations = [
        migrations.RunPython(drop_module_columns, restore_module_columns),
    ]
