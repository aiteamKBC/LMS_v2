from collections import OrderedDict

from django.db import migrations


COURSES_TABLE = 'free_courses'
WEEKS_TABLE = 'free_course_weeks'
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


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, COURSES_TABLE) or not table_exists(cursor, WEEKS_TABLE):
            return
        if not column_exists(cursor, COURSES_TABLE, 'week_id'):
            return
        if not column_exists(cursor, WEEKS_TABLE, 'course_id'):
            cursor.execute(f'alter table {table_name(WEEKS_TABLE)} add column course_id varchar(128)')

        cursor.execute(f'select count(*) from {table_name(WEEKS_TABLE)}')
        week_count = cursor.fetchone()[0]
        if week_count:
            return

        cursor.execute(
            f'''
            select id, week_id, course_name, description, cover_image_url, week_number, week_title,
                   display_order, component_count, total_otjh, created_at, updated_at
            from {table_name(COURSES_TABLE)}
            order by display_order, created_at nulls last, id
            '''
        )
        old_rows = cursor.fetchall()
        if not old_rows:
            return

        groups = OrderedDict()
        for row in old_rows:
            (
                row_id,
                week_id,
                course_name,
                description,
                cover_image_url,
                week_number,
                week_title,
                display_order,
                component_count,
                total_otjh,
                created_at,
                updated_at,
            ) = row
            key = (course_name or '', description or '', cover_image_url or '')
            if key not in groups:
                groups[key] = {
                    'id': row_id,
                    'course_name': course_name or '',
                    'description': description or '',
                    'cover_image_url': cover_image_url or '',
                    'display_order': display_order or len(groups),
                    'week_rows': [],
                    'component_count': 0,
                    'total_otjh': 0,
                    'created_at': created_at,
                    'updated_at': updated_at,
                }
            group = groups[key]
            group['week_rows'].append(row)
            group['component_count'] += component_count or 0
            group['total_otjh'] += total_otjh or 0

        for group in groups.values():
            for row in group['week_rows']:
                (
                    row_id,
                    week_id,
                    course_name,
                    description,
                    cover_image_url,
                    week_number,
                    week_title,
                    display_order,
                    component_count,
                    total_otjh,
                    created_at,
                    updated_at,
                ) = row
                cursor.execute(
                    f'''
                    insert into {table_name(WEEKS_TABLE)}
                        (id, course_id, week_id, course_name, description, cover_image_url, week_number, week_title,
                         display_order, component_count, total_otjh, created_at, updated_at)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, current_timestamp), coalesce(%s, current_timestamp))
                    on conflict (id) do update set
                        course_id = excluded.course_id,
                        week_id = excluded.week_id,
                        course_name = excluded.course_name,
                        description = excluded.description,
                        cover_image_url = excluded.cover_image_url,
                        week_number = excluded.week_number,
                        week_title = excluded.week_title,
                        display_order = excluded.display_order,
                        component_count = excluded.component_count,
                        total_otjh = excluded.total_otjh,
                        updated_at = current_timestamp
                    ''',
                    [
                        row_id,
                        group['id'],
                        week_id,
                        course_name or '',
                        description or '',
                        cover_image_url or '',
                        week_number or 1,
                        week_title or '',
                        display_order or 0,
                        component_count or 0,
                        total_otjh or 0,
                        created_at,
                        updated_at,
                    ],
                )

        cursor.execute(f'delete from {table_name(COURSES_TABLE)}')
        for group in groups.values():
            cursor.execute(
                f'''
                insert into {table_name(COURSES_TABLE)}
                    (id, course_name, description, cover_image_url, display_order, week_count, component_count, total_otjh, created_at, updated_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, current_timestamp), coalesce(%s, current_timestamp))
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
                    len(group['week_rows']),
                    group['component_count'],
                    group['total_otjh'],
                    group['created_at'],
                    group['updated_at'],
                ],
            )
            week_ids = [row[0] for row in group['week_rows']]
            placeholders = ', '.join(['%s'] * len(week_ids))
            cursor.execute(
                f'update {table_name(AUTHORING_WEEKS_TABLE)} set module_catalogue_id = %s where module_catalogue_id in ({placeholders})',
                [group['id'], *week_ids],
            )

        cursor.execute(f'alter table {table_name(WEEKS_TABLE)} alter column course_id set not null')
        cursor.execute(f'create index if not exists curriculum_free_course_weeks_course_idx on {table_name(WEEKS_TABLE)} (course_id)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0034_split_free_courses_and_weeks'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
