from django.db import migrations


STAFF_CONFIG = {
    'coaches': ('COACH', 'assigned_group_ids'),
    'tutors': ('TUTOR', 'assigned_module_ids'),
}


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def clean_blank_staff_profiles_and_ids(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        for table, (prefix, assignment_column) in STAFF_CONFIG.items():
            cursor.execute(
                f'''
                delete from {table_name(connection, table)}
                where lower(coalesce(nullif(trim(name), ''), 'empty_string')) = 'empty_string'
                  and lower(coalesce(nullif(trim(email), ''), 'empty_string')) = 'empty_string'
                  and coalesce(jsonb_array_length(coalesce({assignment_column}, '[]'::jsonb)), 0) = 0
                '''
            )
            cursor.execute(
                f'''
                select id
                from {table_name(connection, table)}
                where lower(id) like %s
                  and id not like %s
                order by id
                ''',
                [f'{prefix.lower()}-%', f'{prefix}-%'],
            )
            for (old_id,) in cursor.fetchall():
                suffix = old_id.split('-', 1)[1]
                new_id = f'{prefix}-{suffix}'
                cursor.execute(
                    f'select 1 from {table_name(connection, table)} where id = %s limit 1',
                    [new_id],
                )
                if cursor.fetchone():
                    continue
                cursor.execute(
                    f'update {table_name(connection, table)} set id = %s where id = %s',
                    [new_id, old_id],
                )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0026_drop_staff_profile_status_specialisms_again'),
    ]

    operations = [
        migrations.RunPython(clean_blank_staff_profiles_and_ids, migrations.RunPython.noop),
    ]
