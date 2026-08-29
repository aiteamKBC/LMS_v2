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


def column_exists(cursor, connection, table, column):
    if connection.vendor == 'postgresql':
        cursor.execute(
            '''
            select 1 from information_schema.columns
            where table_schema = %s and table_name = %s and column_name = %s
            limit 1
            ''',
            ['curriculum', table, column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection, table)})')
    return any(row[1] == column for row in cursor.fetchall())


def parsed_items(value):
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        result = json.loads(value)
    except (TypeError, ValueError):
        return []
    return result if isinstance(result, list) else []


def comparable_name(value):
    # Singularising the individual words makes the existing
    # "Project Control Professional" profile match the official
    # "Project controls professional" title without a brittle hard-coded alias.
    words = re.findall(r'[a-z0-9]+', str(value or '').lower())
    return ' '.join(word[:-1] if len(word) > 3 and word.endswith('s') and not word.endswith('ss') else word for word in words)


def standard_source_id(standard_ref, version):
    # Match curriculum_api.views.slugify, which turns the decimal separator in
    # version 1.5 into a dash. django.utils.text.slugify would remove it and
    # produce v15, an id the standards endpoint does not expose.
    return re.sub(r'[^a-z0-9]+', '-', f'{standard_ref}-v{version}'.lower()).strip('-')


def profile_codes(value):
    result = set()
    for item in parsed_items(value):
        code = str(item.get('code') or item.get('ksb_code') or '').strip().upper()
        kind = str(item.get('type') or item.get('ksb_type') or '').strip().upper()[:1]
        if code and code[:1] not in {'K', 'S', 'B'} and kind in {'K', 'S', 'B'}:
            code = f'{kind}{code}'
        if code:
            result.add(code.replace(' ', ''))
    return result


def add_and_backfill(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection, 'ksb_profiles'):
            return
        if not column_exists(cursor, connection, 'ksb_profiles', 'standard_source_id'):
            cursor.execute(
                f'alter table {table_name(connection, "ksb_profiles")} '
                'add column "standard_source_id" varchar(128)'
            )
        if not table_exists(cursor, connection, 'standard_ksbs'):
            return

        cursor.execute(
            f'select standard_ref, standard_version, standard_title, ksb_code '
            f'from {table_name(connection, "standard_ksbs")}'
        )
        standards = {}
        for standard_ref, version, title, code in cursor.fetchall():
            source_id = standard_source_id(standard_ref, version)
            standard = standards.setdefault(source_id, {
                'name': comparable_name(title),
                'codes': set(),
            })
            if code:
                standard['codes'].add(str(code).strip().upper().replace(' ', ''))

        cursor.execute(
            f'select id, name, ksb_items, standard_source_id '
            f'from {table_name(connection, "ksb_profiles")}'
        )
        for profile_id, name, items, current_source in cursor.fetchall():
            if str(current_source or '').strip():
                continue
            name_key = comparable_name(name)
            name_matches = [source_id for source_id, standard in standards.items() if standard['name'] == name_key]
            chosen = name_matches[0] if len(name_matches) == 1 else ''

            if not chosen:
                codes = profile_codes(items)
                ranked = []
                for source_id, standard in standards.items():
                    overlap = len(codes.intersection(standard['codes']))
                    ratio = overlap / max(1, len(codes))
                    ranked.append((ratio, overlap, source_id))
                ranked.sort(reverse=True)
                if ranked and ranked[0][0] >= 0.6 and ranked[0][1] >= 3:
                    chosen = ranked[0][2]

            if chosen:
                cursor.execute(
                    f'update {table_name(connection, "ksb_profiles")} '
                    'set standard_source_id = %s where id = %s',
                    [chosen, profile_id],
                )


def remove_column(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if table_exists(cursor, connection, 'ksb_profiles') and column_exists(
            cursor, connection, 'ksb_profiles', 'standard_source_id'
        ):
            cursor.execute(
                f'alter table {table_name(connection, "ksb_profiles")} '
                'drop column "standard_source_id"'
            )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0055_recording_events_artifact_fk_cascade'),
        ('curriculum_api', '0054_component_reflection_question'),
    ]

    operations = [
        migrations.RunPython(add_and_backfill, remove_column),
    ]
