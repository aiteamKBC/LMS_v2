from django.db import migrations


OLD_TABLE = 'free_programme_modules'
NEW_TABLE = 'free_courses'


def table_exists(cursor, table):
    cursor.execute(
        '''
        select to_regclass(%s)
        ''',
        [f'curriculum.{table}'],
    )
    return bool(cursor.fetchone()[0])


def rename_table(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        old_exists = table_exists(cursor, OLD_TABLE)
        new_exists = table_exists(cursor, NEW_TABLE)
        if old_exists and not new_exists:
            cursor.execute(f'alter table curriculum."{OLD_TABLE}" rename to "{NEW_TABLE}"')


def rename_table_back(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        old_exists = table_exists(cursor, OLD_TABLE)
        new_exists = table_exists(cursor, NEW_TABLE)
        if new_exists and not old_exists:
            cursor.execute(f'alter table curriculum."{NEW_TABLE}" rename to "{OLD_TABLE}"')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0028_timestamp_staff_profile_ids'),
    ]

    operations = [
        migrations.RunPython(rename_table, rename_table_back),
    ]
