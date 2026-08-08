import json

from django.db import migrations


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute(
            '''
            select 1
            from information_schema.tables
            where table_schema = %s
              and table_name = %s
            limit 1
            ''',
            ['curriculum', table],
        )
        return bool(cursor.fetchone())
    cursor.execute("select name from sqlite_master where type = 'table' and name = %s", [table])
    return bool(cursor.fetchone())


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


def normalise(value):
    return ' '.join(str(value or '').strip().lower().split())


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


def json_value(connection, values):
    payload = json.dumps(values)
    return payload


def update_json_column(cursor, connection, table, column, row_id, values):
    if connection.vendor == 'postgresql':
        cursor.execute(
            f'update {table_name(connection, table)} set {column} = %s::jsonb, updated_at = current_timestamp where id = %s',
            [json_value(connection, values), row_id],
        )
    else:
        cursor.execute(
            f'update {table_name(connection, table)} set {column} = %s, updated_at = current_timestamp where id = %s',
            [json_value(connection, values), row_id],
        )


def rebuild_staff_assignment_ids(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        required = ['modules', 'groups', 'tutors', 'coaches']
        if any(not table_exists(cursor, connection, table) for table in required):
            return
        if not column_exists(cursor, connection, 'tutors', 'assigned_module_ids'):
            return
        if not column_exists(cursor, connection, 'coaches', 'assigned_group_ids'):
            return

        cursor.execute(f'select module_catalogue_id, tutor_name, coach_name, group_id from {table_name(connection, "modules")}')
        modules = cursor.fetchall()
        cursor.execute(f'select group_id, coach_name from {table_name(connection, "groups")}')
        groups = cursor.fetchall()

        valid_group_ids = {str(row[0] or '').strip() for row in groups if str(row[0] or '').strip()}
        tutor_module_ids = {}
        coach_group_ids = {}

        for module_id, tutor_name, coach_name, group_id in modules:
            module_id = str(module_id or '').strip()
            tutor_key = normalise(tutor_name)
            if module_id and tutor_key:
                tutor_module_ids.setdefault(tutor_key, []).append(module_id)
            group_id = str(group_id or '').strip()
            coach_key = normalise(coach_name)
            if coach_key and group_id and (not valid_group_ids or group_id in valid_group_ids):
                coach_group_ids.setdefault(coach_key, []).append(group_id)

        for group_id, coach_name in groups:
            group_id = str(group_id or '').strip()
            coach_key = normalise(coach_name)
            if coach_key and group_id:
                coach_group_ids.setdefault(coach_key, []).append(group_id)

        cursor.execute(f'select id, name from {table_name(connection, "tutors")}')
        for row_id, name in cursor.fetchall():
            update_json_column(
                cursor,
                connection,
                'tutors',
                'assigned_module_ids',
                row_id,
                unique(tutor_module_ids.get(normalise(name), [])),
            )

        cursor.execute(f'select id, name from {table_name(connection, "coaches")}')
        for row_id, name in cursor.fetchall():
            update_json_column(
                cursor,
                connection,
                'coaches',
                'assigned_group_ids',
                row_id,
                unique(coach_group_ids.get(normalise(name), [])),
            )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0015_drop_group_mode_column'),
    ]

    operations = [
        migrations.RunPython(rebuild_staff_assignment_ids, migrations.RunPython.noop),
    ]
