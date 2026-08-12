from django.db import migrations


COURSES_TABLE = 'free_courses'
WEEKS_TABLE = 'free_course_weeks'


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
        if not table_exists(cursor, COURSES_TABLE):
            return
        if not column_exists(cursor, COURSES_TABLE, 'week_builder_week_ids'):
            cursor.execute(f"alter table {table_name(COURSES_TABLE)} add column week_builder_week_ids jsonb not null default '[]'::jsonb")
        if not table_exists(cursor, WEEKS_TABLE):
            return
        cursor.execute(
            f'''
            update {table_name(COURSES_TABLE)} course
            set week_builder_week_ids = coalesce(weeks.week_ids, '[]'::jsonb),
                updated_at = current_timestamp
            from (
                select course_id, jsonb_agg(week_id order by display_order, week_number, id) as week_ids
                from {table_name(WEEKS_TABLE)}
                where coalesce(week_id, '') <> ''
                group by course_id
            ) weeks
            where weeks.course_id = course.id
            '''
        )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0036_drop_week_columns_from_free_courses'),
    ]

    operations = [
        migrations.RunPython(apply_schema, migrations.RunPython.noop),
    ]
