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
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'programmes'):
            return
        cursor.execute('''
            alter table curriculum."programmes"
            add column if not exists status varchar(32) not null default 'active'
        ''')
        cursor.execute('''
            update curriculum."programmes"
               set status = 'active'
             where coalesce(btrim(status), '') = ''
        ''')
        cursor.execute('''
            create index if not exists curriculum_programmes_status_idx
            on curriculum."programmes" (status)
        ''')


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'programmes'):
            return
        cursor.execute('drop index if exists curriculum."curriculum_programmes_status_idx"')
        if column_exists(cursor, 'programmes', 'status'):
            cursor.execute('alter table curriculum."programmes" drop column status')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0043_backfill_component_ksb_mappings_from_projection'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
