import json
import re

from django.db import migrations


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name=%s limit 1", [table])
    return bool(cursor.fetchone())


def normalise(value):
    return ' '.join(str(value or '').strip().lower().split())


def slugify(value):
    text = re.sub(r'[^a-z0-9]+', '-', str(value or '').strip().lower()).strip('-')
    return text or 'staff'


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


def json_param(connection, values):
    return json.dumps(values)


def update_json_column(cursor, connection, table, column, row_id, values):
    if connection.vendor == 'postgresql':
        cursor.execute(
            f'update {table_name(connection, table)} set {column} = %s::jsonb, updated_at = current_timestamp where id = %s',
            [json_param(connection, values), row_id],
        )
    else:
        cursor.execute(
            f'update {table_name(connection, table)} set {column} = %s, updated_at = current_timestamp where id = %s',
            [json_param(connection, values), row_id],
        )


def insert_staff(cursor, connection, table, prefix, name, assignment_column):
    row_id = f'{prefix}-{slugify(name)}'
    cursor.execute(f'select id from {table_name(connection, table)} where id = %s', [row_id])
    if cursor.fetchone():
        row_id = f'{row_id}-profile'
    empty_json = json_param(connection, [])
    json_cast = '::jsonb' if connection.vendor == 'postgresql' else ''
    cursor.execute(
        f'''
        insert into {table_name(connection, table)}
            (id, name, email, phone, job_title, status, specialisms, {assignment_column}, notes, is_archived, created_at, updated_at)
        values
            (%s, %s, '', '', '', 'active', %s{json_cast}, %s{json_cast}, '', false, current_timestamp, current_timestamp)
        ''',
        [row_id, name, empty_json, empty_json],
    )
    return row_id


def ensure_staff_profiles(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        modules = []
        groups = []
        if table_exists(cursor, connection, 'modules'):
            cursor.execute(f'select module_catalogue_id, tutor_name, coach_name, group_id from {table_name(connection, "modules")}')
            modules = cursor.fetchall()
        if table_exists(cursor, connection, 'groups'):
            cursor.execute(f'select group_id, coach_name from {table_name(connection, "groups")}')
            groups = cursor.fetchall()

        valid_group_ids = {str(group_id or '').strip() for group_id, _coach_name in groups if str(group_id or '').strip()}
        tutor_module_ids = {}
        coach_group_ids = {}
        tutor_names = {}
        coach_names = {}

        for module_id, tutor_name, coach_name, group_id in modules:
            module_id = str(module_id or '').strip()
            tutor_key = normalise(tutor_name)
            if module_id and tutor_key and tutor_key != 'unassigned':
                tutor_names.setdefault(tutor_key, str(tutor_name or '').strip())
                tutor_module_ids.setdefault(tutor_key, []).append(module_id)
            group_id = str(group_id or '').strip()
            coach_key = normalise(coach_name)
            if coach_key and coach_key != 'unassigned' and group_id and (not valid_group_ids or group_id in valid_group_ids):
                coach_names.setdefault(coach_key, str(coach_name or '').strip())
                coach_group_ids.setdefault(coach_key, []).append(group_id)

        for group_id, coach_name in groups:
            group_id = str(group_id or '').strip()
            coach_key = normalise(coach_name)
            if coach_key and coach_key != 'unassigned' and group_id:
                coach_names.setdefault(coach_key, str(coach_name or '').strip())
                coach_group_ids.setdefault(coach_key, []).append(group_id)

        cursor.execute(f'select id, name from {table_name(connection, "tutors")}')
        tutors = cursor.fetchall()
        tutor_by_key = {normalise(name): row_id for row_id, name in tutors}
        for key, name in tutor_names.items():
            if key not in tutor_by_key:
                tutor_by_key[key] = insert_staff(cursor, connection, 'tutors', 'TUTOR', name, 'assigned_module_ids')
        for key, row_id in tutor_by_key.items():
            update_json_column(cursor, connection, 'tutors', 'assigned_module_ids', row_id, unique(tutor_module_ids.get(key, [])))

        cursor.execute(f'select id, name from {table_name(connection, "coaches")}')
        coaches = cursor.fetchall()
        coach_by_key = {normalise(name): row_id for row_id, name in coaches}
        for key, name in coach_names.items():
            if key not in coach_by_key:
                coach_by_key[key] = insert_staff(cursor, connection, 'coaches', 'COACH', name, 'assigned_group_ids')
        for key, row_id in coach_by_key.items():
            update_json_column(cursor, connection, 'coaches', 'assigned_group_ids', row_id, unique(coach_group_ids.get(key, [])))


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0016_rebuild_staff_assignment_ids'),
    ]

    operations = [
        migrations.RunPython(ensure_staff_profiles, migrations.RunPython.noop),
    ]
