from datetime import datetime, timedelta

from django.db import migrations


FREE_COURSES_TABLE = 'free_courses'
FREE_COMPONENTS_TABLE = 'free_programme_components'
WEEKS_TABLE = 'weeks'


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


def valid_timestamp_id(value, prefix):
    value = value or ''
    return value.startswith(f'{prefix}-') and len(value) == len(prefix) + 21 and value.split('-', 1)[1].isdigit()


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, FREE_COURSES_TABLE):
            return

        for column, ddl in {
            'week_id': 'varchar(128)',
            'week_number': 'integer not null default 1',
            'week_title': "varchar(500) not null default ''",
        }.items():
            if not column_exists(cursor, FREE_COURSES_TABLE, column):
                cursor.execute(f'alter table {table_name(FREE_COURSES_TABLE)} add column {column} {ddl}')

        if table_exists(cursor, FREE_COMPONENTS_TABLE) and not column_exists(cursor, FREE_COMPONENTS_TABLE, 'week_id'):
            cursor.execute(f'alter table {table_name(FREE_COMPONENTS_TABLE)} add column week_id varchar(128)')

        cursor.execute(f'create index if not exists curriculum_free_courses_week_idx on {table_name(FREE_COURSES_TABLE)} (week_id)')
        if table_exists(cursor, FREE_COMPONENTS_TABLE):
            cursor.execute(f'create index if not exists curriculum_free_programme_components_week_idx on {table_name(FREE_COMPONENTS_TABLE)} (week_id)')

        cursor.execute(f'select id from {table_name(FREE_COURSES_TABLE)}')
        used_course_ids = {row[0] for row in cursor.fetchall()}
        cursor.execute(f'select id from {table_name(WEEKS_TABLE)}')
        used_week_ids = {row[0] for row in cursor.fetchall()}

        cursor.execute(
            f'''
            select id, title, description, display_order, week_id, week_number, week_title
            from {table_name(FREE_COURSES_TABLE)}
            order by created_at nulls last, id
            '''
        )
        rows = cursor.fetchall()
        for index, (old_course_id, title, description, display_order, week_id, week_number, week_title) in enumerate(rows):
            course_id = old_course_id
            if not valid_timestamp_id(course_id, 'FREECOURSE'):
                course_id = unique_id('FREECOURSE', used_course_ids, index)
                cursor.execute(f'update {table_name(FREE_COURSES_TABLE)} set id = %s where id = %s', [course_id, old_course_id])
                if table_exists(cursor, FREE_COMPONENTS_TABLE):
                    cursor.execute(f'update {table_name(FREE_COMPONENTS_TABLE)} set free_module_id = %s where free_module_id = %s', [course_id, old_course_id])

            next_week_id = week_id if valid_timestamp_id(week_id, 'WEEK') else unique_id('WEEK', used_week_ids, index)
            next_week_number = week_number or 1
            next_week_title = week_title or f'Week {next_week_number}'
            cursor.execute(
                f'''
                insert into {table_name(WEEKS_TABLE)}
                    (id, module_catalogue_id, week_number, title, summary, learning_outcomes, display_order, created_at, updated_at)
                values (%s, %s, %s, %s, %s, '[]'::jsonb, %s, current_timestamp, current_timestamp)
                on conflict (id) do update set
                    module_catalogue_id = excluded.module_catalogue_id,
                    week_number = excluded.week_number,
                    title = excluded.title,
                    summary = excluded.summary,
                    display_order = excluded.display_order,
                    updated_at = current_timestamp
                ''',
                [next_week_id, course_id, next_week_number, next_week_title, description or '', display_order or index],
            )
            cursor.execute(
                f'update {table_name(FREE_COURSES_TABLE)} set week_id = %s, week_number = %s, week_title = %s where id = %s',
                [next_week_id, next_week_number, next_week_title, course_id],
            )
            if table_exists(cursor, FREE_COMPONENTS_TABLE):
                cursor.execute(
                    f'update {table_name(FREE_COMPONENTS_TABLE)} set week_id = %s where free_module_id = %s',
                    [next_week_id, course_id],
                )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0029_rename_free_programme_modules_to_free_courses'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
