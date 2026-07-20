import json
from collections import OrderedDict

from django.db import migrations


def clean_str(value):
    return str(value or '').strip()


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
        return bool(cursor.fetchone()[0])
    cursor.execute("select name from sqlite_master where type='table' and name=%s", [table])
    return bool(cursor.fetchone())


def unique(values):
    seen = set()
    result = []
    for value in values:
        item = clean_str(value)
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def rows_as_dicts(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def backfill_parent_rows(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('create schema if not exists curriculum')

        required_tables = ['programmes', 'cohorts', 'groups', 'modules']
        if not all(table_exists(cursor, connection, table) for table in required_tables):
            return

        cursor.execute(f'select program_id from {table_name(connection, "programmes")}')
        existing_programmes = {clean_str(row[0]) for row in cursor.fetchall()}
        programme_sources = OrderedDict()
        for table, id_column, name_column in [
            ('cohorts', 'programme_id', 'programme_name'),
            ('groups', 'programme_id', 'programme_name'),
            ('modules', 'programme_id', 'programme_name'),
        ]:
            cursor.execute(f'''
                select {id_column}, {name_column}
                from {table_name(connection, table)}
                where coalesce({id_column}, '') <> ''
            ''')
            for programme_id, programme_name in cursor.fetchall():
                programme_id = clean_str(programme_id)
                if programme_id and programme_id not in existing_programmes:
                    programme_sources.setdefault(programme_id, clean_str(programme_name) or programme_id)

        for programme_id, programme_name in programme_sources.items():
            cursor.execute(
                f'''
                insert into {table_name(connection, "programmes")}
                (program_id, name, sub, color, created_at, updated_at, status, is_active, is_archived, structure_type)
                values (%s, %s, %s, %s, current_timestamp, current_timestamp, %s, %s, %s, %s)
                ''',
                [programme_id, programme_name, programme_name, '#6941c6', 'planned', True, False, 'scheduled'],
            )
            existing_programmes.add(programme_id)

        cursor.execute(f'select cohort_id from {table_name(connection, "cohorts")}')
        existing_cohorts = {clean_str(row[0]) for row in cursor.fetchall()}

        cohort_sources = OrderedDict()
        cursor.execute(f'''
            select
                group_id,
                group_name,
                cohort_id,
                cohort_name,
                programme_id,
                programme_name,
                module_names,
                training_plan_ids,
                start_date,
                end_date,
                status,
                source_id
            from {table_name(connection, "groups")}
            where coalesce(cohort_id, '') <> ''
        ''')
        for row in rows_as_dicts(cursor):
            cohort_id = clean_str(row.get('cohort_id'))
            if not cohort_id or cohort_id in existing_cohorts:
                continue
            cohort = cohort_sources.setdefault(cohort_id, {
                'cohort_id': cohort_id,
                'cohort_name': clean_str(row.get('cohort_name')) or cohort_id,
                'programme_id': clean_str(row.get('programme_id')),
                'programme_name': clean_str(row.get('programme_name')),
                'start_date': row.get('start_date'),
                'end_date': row.get('end_date'),
                'status': clean_str(row.get('status')) or 'planned',
                'group_ids': [],
                'module_names': [],
                'training_plan_ids': [],
                'source_id': clean_str(row.get('source_id')),
            })
            cohort['group_ids'].append(row.get('group_id'))
            cohort['module_names'].extend(json.loads(row.get('module_names') or '[]') if isinstance(row.get('module_names'), str) else (row.get('module_names') or []))
            cohort['training_plan_ids'].extend(json.loads(row.get('training_plan_ids') or '[]') if isinstance(row.get('training_plan_ids'), str) else (row.get('training_plan_ids') or []))

        cursor.execute(f'''
            select
                module_catalogue_id,
                title,
                cohort_id,
                cohort_name,
                programme_id,
                programme_name,
                group_id,
                imported_from_training_plan_id,
                source_id,
                start_date,
                end_date,
                status
            from {table_name(connection, "modules")}
            where coalesce(cohort_id, '') <> ''
        ''')
        for row in rows_as_dicts(cursor):
            cohort_id = clean_str(row.get('cohort_id'))
            if not cohort_id or cohort_id in existing_cohorts:
                continue
            cohort = cohort_sources.setdefault(cohort_id, {
                'cohort_id': cohort_id,
                'cohort_name': clean_str(row.get('cohort_name')) or cohort_id,
                'programme_id': clean_str(row.get('programme_id')),
                'programme_name': clean_str(row.get('programme_name')),
                'start_date': row.get('start_date'),
                'end_date': row.get('end_date'),
                'status': clean_str(row.get('status')) or 'planned',
                'group_ids': [],
                'module_names': [],
                'training_plan_ids': [],
                'source_id': clean_str(row.get('source_id') or row.get('imported_from_training_plan_id')),
            })
            cohort['group_ids'].append(row.get('group_id'))
            cohort['module_names'].append(row.get('title'))
            cohort['training_plan_ids'].append(row.get('imported_from_training_plan_id') or row.get('source_id'))
            start_date = row.get('start_date')
            end_date = row.get('end_date')
            if start_date and (not cohort['start_date'] or start_date < cohort['start_date']):
                cohort['start_date'] = start_date
            if end_date and (not cohort['end_date'] or end_date > cohort['end_date']):
                cohort['end_date'] = end_date

        for cohort in cohort_sources.values():
            cursor.execute(
                f'''
                insert into {table_name(connection, "cohorts")}
                (
                    cohort_id, cohort_name, programme_id, programme_name,
                    start_date, end_date, duration_months, color, status,
                    training_plan_ids, group_ids, module_names,
                    holiday_ids, selected_holidays, holidays_in_range, holiday_summary,
                    notes, source_type, source_id, created_at, updated_at
                )
                values (
                    %s, %s, %s, %s,
                    %s, %s, 0, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, current_timestamp, current_timestamp
                )
                ''',
                [
                    cohort['cohort_id'],
                    cohort['cohort_name'],
                    cohort['programme_id'],
                    cohort['programme_name'],
                    cohort['start_date'],
                    cohort['end_date'],
                    '#6941c6',
                    cohort['status'],
                    json.dumps(unique(cohort['training_plan_ids'])),
                    json.dumps(unique(cohort['group_ids'])),
                    json.dumps(unique(cohort['module_names'])),
                    json.dumps([]),
                    json.dumps([]),
                    json.dumps([]),
                    json.dumps({}),
                    '',
                    'module_authoring',
                    cohort['source_id'],
                ],
            )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0005_create_groups_table'),
    ]

    operations = [
        migrations.RunPython(backfill_parent_rows, migrations.RunPython.noop),
    ]
