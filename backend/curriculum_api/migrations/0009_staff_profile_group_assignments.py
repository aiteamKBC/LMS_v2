import json

from django.db import migrations, models


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


def add_group_assignment_columns(apps, schema_editor):
    connection = schema_editor.connection
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    default_value = "'[]'::jsonb" if connection.vendor == 'postgresql' else "'[]'"
    with connection.cursor() as cursor:
        if not column_exists(cursor, connection, 'coaches', 'assigned_group_ids'):
            cursor.execute(
                f'alter table {table_name(connection, "coaches")} add column assigned_group_ids {json_type}'
            )
        cursor.execute(
            f'update {table_name(connection, "coaches")} set assigned_group_ids = {default_value} where assigned_group_ids is null'
        )
        backfill_coach_group_assignments(cursor, connection)


def parse_json_list(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()] if isinstance(parsed, list) else []


def group_assignment_tokens(row):
    tokens = set()
    for key in ('module_ids', 'training_plan_ids'):
        for item in parse_json_list(row.get(key)):
            tokens.add(item)
            tokens.add(f'training-module-{item}')
    return tokens


def backfill_coach_group_assignments(cursor, connection):
    cursor.execute(f'select group_id, module_ids, training_plan_ids from {table_name(connection, "groups")}')
    group_columns = [column[0] for column in cursor.description]
    groups = [dict(zip(group_columns, row)) for row in cursor.fetchall()]
    group_tokens = [(row, group_assignment_tokens(row)) for row in groups]

    cursor.execute(f'select id, assigned_module_ids, assigned_group_ids from {table_name(connection, "coaches")}')
    coach_columns = [column[0] for column in cursor.description]
    for coach in [dict(zip(coach_columns, row)) for row in cursor.fetchall()]:
        module_ids = set(parse_json_list(coach.get('assigned_module_ids')))
        group_ids = parse_json_list(coach.get('assigned_group_ids'))
        for group, tokens in group_tokens:
            group_id = str(group.get('group_id') or '').strip()
            if group_id and group_id not in group_ids and module_ids.intersection(tokens):
                group_ids.append(group_id)
        cursor.execute(
            f'update {table_name(connection, "coaches")} set assigned_group_ids = %s where id = %s',
            [json.dumps(group_ids), coach.get('id')],
        )


def remove_group_assignment_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        cursor.execute(f'alter table {table_name(connection, "coaches")} drop column if exists assigned_group_ids')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0008_create_staff_profile_tables'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(add_group_assignment_columns, remove_group_assignment_columns),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='coach',
                    name='assigned_group_ids',
                    field=models.JSONField(blank=True, default=list),
                ),
            ],
        ),
    ]
