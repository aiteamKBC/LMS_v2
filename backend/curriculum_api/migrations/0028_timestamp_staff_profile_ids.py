from datetime import datetime, timedelta

from django.db import migrations


STAFF_CONFIG = {
    'coaches': 'COACH',
    'tutors': 'TUTOR',
}


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def timestamp_staff_profile_ids(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    now = datetime.utcnow()
    with connection.cursor() as cursor:
        for table, prefix in STAFF_CONFIG.items():
            cursor.execute(
                f'''
                select id
                from {table_name(connection, table)}
                where id !~ %s
                order by created_at nulls last, id
                ''',
                [rf'^{prefix}-[0-9]{{20}}$'],
            )
            for index, (old_id,) in enumerate(cursor.fetchall()):
                stamp = (now + timedelta(microseconds=index)).strftime('%Y%m%d%H%M%S%f')
                new_id = f'{prefix}-{stamp}'
                cursor.execute(
                    f'select 1 from {table_name(connection, table)} where id = %s limit 1',
                    [new_id],
                )
                while cursor.fetchone():
                    now = now + timedelta(microseconds=1)
                    stamp = now.strftime('%Y%m%d%H%M%S%f')
                    new_id = f'{prefix}-{stamp}'
                    cursor.execute(
                        f'select 1 from {table_name(connection, table)} where id = %s limit 1',
                        [new_id],
                    )
                cursor.execute(
                    f'update {table_name(connection, table)} set id = %s where id = %s',
                    [new_id, old_id],
                )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0027_clean_blank_staff_profiles_normalise_ids'),
    ]

    operations = [
        migrations.RunPython(timestamp_staff_profile_ids, migrations.RunPython.noop),
    ]
