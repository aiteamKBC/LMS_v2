import re

from django.db import migrations


NEW_COLUMNS = {
    'session_week_day': 'varchar(255)',
    'session_start_time': 'varchar(32)',
    'session_end_time': 'varchar(32)',
}

DROP_COLUMNS = ('start_date', 'end_date', 'schedule')


def table_name(connection):
    return 'curriculum."groups"' if connection.vendor == 'postgresql' else '"groups"'


def table_exists(cursor, connection):
    if connection.vendor == 'postgresql':
        cursor.execute("select to_regclass('curriculum.groups')")
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name='groups' limit 1")
    return bool(cursor.fetchone())


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
            ['curriculum', 'groups', column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection)})')
    return any(row[1] == column for row in cursor.fetchall())


def split_schedule(value):
    text = str(value or '').strip()
    match = re.search(r'(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)', text, re.I)
    if not match:
        return text, '', ''
    day = text.split(match.group(1), 1)[0].strip(' ,|-–')
    return day, match.group(1).strip(), match.group(2).strip()


def split_group_schedule_and_drop_dates(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection):
            return
        for column, column_type in NEW_COLUMNS.items():
            if not column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')
        if column_exists(cursor, connection, 'schedule'):
            cursor.execute(f'select group_id, schedule from {table_name(connection)}')
            for group_id, schedule in cursor.fetchall():
                day, start, end = split_schedule(schedule)
                cursor.execute(
                    f'''
                    update {table_name(connection)}
                    set session_week_day = coalesce(nullif(session_week_day, ''), %s),
                        session_start_time = coalesce(nullif(session_start_time, ''), %s),
                        session_end_time = coalesce(nullif(session_end_time, ''), %s)
                    where group_id = %s
                    ''',
                    [day, start, end, group_id],
                )
        for column in DROP_COLUMNS:
            if column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} drop column "{column}"')


def restore_group_schedule_and_dates(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection):
            return
        restore_columns = {
            'start_date': 'date',
            'end_date': 'date',
            'schedule': 'varchar(255)',
        }
        for column, column_type in restore_columns.items():
            if not column_exists(cursor, connection, column):
                cursor.execute(f'alter table {table_name(connection)} add column "{column}" {column_type}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0023_drop_group_tutor_name'),
    ]

    operations = [
        migrations.RunPython(split_group_schedule_and_drop_dates, restore_group_schedule_and_dates),
    ]

