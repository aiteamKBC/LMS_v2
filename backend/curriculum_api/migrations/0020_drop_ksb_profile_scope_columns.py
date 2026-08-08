from django.db import migrations


KSB_PROFILE_SCOPE_COLUMNS = {
    'cohort_ids': {
        'postgres': 'jsonb',
        'sqlite': 'text',
    },
    'group_ids': {
        'postgres': 'jsonb',
        'sqlite': 'text',
    },
    'module_catalogue_ids': {
        'postgres': 'jsonb',
        'sqlite': 'text',
    },
}


def table_name(connection):
    return 'curriculum."ksb_profiles"' if connection.vendor == 'postgresql' else '"ksb_profiles"'


def table_exists(cursor, connection):
    if connection.vendor == 'postgresql':
        cursor.execute("select to_regclass('curriculum.ksb_profiles')")
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name='ksb_profiles' limit 1")
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
            ['curriculum', 'ksb_profiles', column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_scope_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection):
            return
        for column in KSB_PROFILE_SCOPE_COLUMNS:
            if column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} drop column "{column}"')


def restore_scope_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection):
            return
        for column, config in KSB_PROFILE_SCOPE_COLUMNS.items():
            if column_exists(cursor, connection, column):
                continue
            column_type = config['postgres'] if connection.vendor == 'postgresql' else config['sqlite']
            cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0019_drop_ksb_profile_legacy_programme_columns'),
    ]

    operations = [
        migrations.RunPython(drop_scope_columns, restore_scope_columns),
    ]
