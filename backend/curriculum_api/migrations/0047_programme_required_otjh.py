from django.db import migrations


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
    cursor.execute(
        '''
        select 1
          from information_schema.columns
         where table_schema = 'curriculum'
           and table_name = %s
           and column_name = %s
        ''',
        [table, column],
    )
    return bool(cursor.fetchone())


def apply_schema(apps, schema_editor):
    # The off-the-job hours a learner must complete to finish the programme. Nullable
    # on purpose: existing programmes have no target recorded, and NULL means "no
    # target set" rather than "zero hours required" — the review step needs to tell
    # those two apart so it can prompt for a target instead of reporting 0h as met.
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'programmes'):
            return
        cursor.execute('''
            alter table curriculum."programmes"
            add column if not exists required_otjh numeric(8, 2)
        ''')


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'programmes'):
            return
        if column_exists(cursor, 'programmes', 'required_otjh'):
            cursor.execute('alter table curriculum."programmes" drop column required_otjh')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0046_delete_blank_staff_profiles'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
