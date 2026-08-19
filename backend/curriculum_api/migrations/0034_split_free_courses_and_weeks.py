from collections import OrderedDict
from datetime import datetime, timedelta

from django.db import migrations


COURSES_TABLE = 'free_courses'
WEEKS_TABLE = 'free_course_weeks'
COMPONENTS_TABLE = 'free_programme_components'
AUTHORING_WEEKS_TABLE = 'weeks'


def table_name(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
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


def unique_id(prefix, used, offset=0):
    current = datetime.utcnow() + timedelta(microseconds=offset)
    while True:
        candidate = f'{prefix}-{current.strftime("%Y%m%d%H%M%S%f")}'
        if candidate not in used:
            used.add(candidate)
            return candidate
        current += timedelta(microseconds=1)


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, COURSES_TABLE):
            return

        if not table_exists(cursor, WEEKS_TABLE):
            cursor.execute(f'alter table {table_name(COURSES_TABLE)} rename to "{WEEKS_TABLE}"')
        else:
            return

        if not column_exists(cursor, WEEKS_TABLE, 'course_id'):
            cursor.execute(f'alter table {table_name(WEEKS_TABLE)} add column course_id varchar(128)')

        cursor.execute(
            f'''
            create table if not exists {table_name(COURSES_TABLE)} (
                id varchar(128) primary key,
                course_name varchar(500) not null default '',
                description text,
                cover_image_url text,
                display_order integer not null default 0,
                week_count integer not null default 0,
                component_count integer not null default 0,
                total_otjh numeric(8,2) not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
            '''
        )

        cursor.execute(
            f'''
            select id, course_name, description, cover_image_url, display_order, component_count, total_otjh, created_at
            from {table_name(WEEKS_TABLE)}
            order by display_order, created_at nulls last, id
            '''
        )
        groups = OrderedDict()
        used_course_ids = set()
        for row in cursor.fetchall():
            week_id, course_name, description, cover_image_url, display_order, component_count, total_otjh, created_at = row
            key = (course_name or '', description or '', cover_image_url or '')
            if key not in groups:
                groups[key] = {
                    'id': week_id or unique_id('FREECOURSE', used_course_ids, len(groups)),
                    'course_name': course_name or '',
                    'description': description or '',
                    'cover_image_url': cover_image_url or '',
                    'display_order': display_order or len(groups),
                    'week_ids': [],
                    'component_count': 0,
                    'total_otjh': 0,
                    'created_at': created_at,
                }
                used_course_ids.add(groups[key]['id'])
            group = groups[key]
            group['week_ids'].append(week_id)
            group['component_count'] += component_count or 0
            group['total_otjh'] += total_otjh or 0

        for group in groups.values():
            cursor.execute(
                f'''
                insert into {table_name(COURSES_TABLE)}
                    (id, course_name, description, cover_image_url, display_order, week_count, component_count, total_otjh, created_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, current_timestamp), current_timestamp)
                on conflict (id) do update set
                    course_name = excluded.course_name,
                    description = excluded.description,
                    cover_image_url = excluded.cover_image_url,
                    display_order = excluded.display_order,
                    week_count = excluded.week_count,
                    component_count = excluded.component_count,
                    total_otjh = excluded.total_otjh,
                    updated_at = current_timestamp
                ''',
                [
                    group['id'],
                    group['course_name'],
                    group['description'],
                    group['cover_image_url'],
                    group['display_order'],
                    len(group['week_ids']),
                    group['component_count'],
                    group['total_otjh'],
                    group['created_at'],
                ],
            )
            placeholders = ', '.join(['%s'] * len(group['week_ids']))
            cursor.execute(
                f'update {table_name(WEEKS_TABLE)} set course_id = %s where id in ({placeholders})',
                [group['id'], *group['week_ids']],
            )
            cursor.execute(
                f'update {table_name(AUTHORING_WEEKS_TABLE)} set module_catalogue_id = %s where module_catalogue_id in ({placeholders})',
                [group['id'], *group['week_ids']],
            )

        cursor.execute(f'alter table {table_name(WEEKS_TABLE)} alter column course_id set not null')
        cursor.execute(f'create index if not exists curriculum_free_course_weeks_course_idx on {table_name(WEEKS_TABLE)} (course_id)')
        cursor.execute(f'create index if not exists curriculum_free_course_weeks_week_idx on {table_name(WEEKS_TABLE)} (week_id)')
        if table_exists(cursor, COMPONENTS_TABLE):
            cursor.execute(f'create index if not exists curriculum_free_programme_components_module_idx on {table_name(COMPONENTS_TABLE)} (free_module_id)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0033_free_courses_cover_image_url'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
