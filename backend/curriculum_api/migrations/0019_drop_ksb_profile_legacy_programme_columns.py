import json

from django.db import migrations


KSB_PROFILE_COLUMNS = {
    'programme_name': {
        'postgres': 'varchar(255)',
        'sqlite': 'varchar(255)',
    },
    'legacy_numeric_id': {
        'postgres': 'bigint',
        'sqlite': 'bigint',
    },
    'programme_id': {
        'postgres': 'varchar(128)',
        'sqlite': 'varchar(128)',
    },
}


def table_name(connection):
    return 'curriculum."ksb_profiles"' if connection.vendor == 'postgresql' else '"ksb_profiles"'


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


def parse_json_list(value):
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def unique(values):
    seen = set()
    result = []
    for value in values:
        text = str(value or '').strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def preserve_programme_values(cursor, connection):
    if not column_exists(cursor, connection, 'programme_ids'):
        json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
        cursor.execute(f'alter table {table_name(connection)} add column "programme_ids" {json_type}')
    has_programme_id = column_exists(cursor, connection, 'programme_id')
    has_programme_name = column_exists(cursor, connection, 'programme_name')
    if not has_programme_id and not has_programme_name:
        return

    columns = ['id', 'programme_ids']
    if has_programme_id:
        columns.append('programme_id')
    if has_programme_name:
        columns.append('programme_name')
    cursor.execute(f'select {", ".join(columns)} from {table_name(connection)}')
    for row in cursor.fetchall():
        values = dict(zip(columns, row))
        next_ids = unique([
            *parse_json_list(values.get('programme_ids')),
            values.get('programme_id'),
            values.get('programme_name'),
        ])
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'update {table_name(connection)} set programme_ids = %s::jsonb where id = %s',
                [json.dumps(next_ids), values.get('id')],
            )
        else:
            cursor.execute(
                f'update {table_name(connection)} set programme_ids = %s where id = %s',
                [json.dumps(next_ids), values.get('id')],
            )


def drop_ksb_profile_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        preserve_programme_values(cursor, connection)
        if connection.vendor == 'postgresql':
            cursor.execute('drop index if exists curriculum_ksb_profiles_programme_id_idx')
        for column in KSB_PROFILE_COLUMNS:
            if column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} drop column "{column}"')


def restore_ksb_profile_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for column, config in KSB_PROFILE_COLUMNS.items():
            if column_exists(cursor, connection, column):
                continue
            column_type = config['postgres'] if connection.vendor == 'postgresql' else config['sqlite']
            cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')
        if connection.vendor == 'postgresql':
            cursor.execute(f'create index if not exists curriculum_ksb_profiles_programme_id_idx on {table_name(connection)} (programme_id)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0018_drop_staff_status_specialisms_columns'),
    ]

    operations = [
        migrations.RunPython(drop_ksb_profile_columns, restore_ksb_profile_columns),
    ]
