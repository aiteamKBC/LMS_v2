from django.db import migrations


STAFF_TABLES = ('coaches', 'tutors')


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def delete_blank_staff_profiles(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        for table in STAFF_TABLES:
            cursor.execute(
                f'''
                delete from {table_name(connection, table)}
                where lower(coalesce(nullif(trim(name), ''), 'empty_string')) in ('empty_string', 'unassigned')
                  and lower(coalesce(nullif(trim(email), ''), 'empty_string')) in ('empty_string', 'unassigned')
                '''
            )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0045_normalise_programme_archive_flags'),
    ]

    operations = [
        migrations.RunPython(delete_blank_staff_profiles, migrations.RunPython.noop),
    ]
