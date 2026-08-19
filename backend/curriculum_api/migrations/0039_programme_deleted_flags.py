"""Hide curriculum children whose programme row has already been removed."""
from django.db import migrations


TABLES = ('groups', 'modules')


def qualified(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
    cursor.execute(
        '''select 1
           from information_schema.columns
           where table_schema = 'curriculum'
             and table_name = %s
             and column_name = %s''',
        [table, column],
    )
    return bool(cursor.fetchone())


def add_deleted_flag(cursor, table):
    if not table_exists(cursor, table):
        print(f'  [skip] curriculum.{table}: table absent')
        return False
    if not column_exists(cursor, table, 'programme_id'):
        print(f'  [skip] curriculum.{table}: programme_id absent')
        return False

    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists is_programme_deleted boolean not null default false
    ''')
    cursor.execute(f'''
        create index if not exists curriculum_{table}_programme_deleted_idx
        on {qualified(table)} (is_programme_deleted)
    ''')
    return True


def mark_orphaned_programmes(cursor, table):
    cursor.execute(f'''
        update {qualified(table)} child
           set is_programme_deleted = true,
               updated_at = coalesce(child.updated_at, current_timestamp)
         where child.is_programme_deleted is distinct from true
           and coalesce(btrim(child.programme_id), '') <> ''
           and not exists (
                select 1
                  from {qualified('programmes')} p
                 where p.programme_id = child.programme_id
           )
    ''')
    print(f'  [flag] curriculum.{table}: {cursor.rowcount} row(s) marked programme-deleted')


def mark_modules_for_deleted_groups(cursor):
    if not table_exists(cursor, 'groups') or not table_exists(cursor, 'modules'):
        return
    if not column_exists(cursor, 'groups', 'is_programme_deleted'):
        return
    cursor.execute(f'''
        update {qualified('modules')} m
           set is_programme_deleted = true,
               updated_at = coalesce(m.updated_at, current_timestamp)
          from {qualified('groups')} g
         where m.is_programme_deleted is distinct from true
           and coalesce(btrim(m.group_id), '') <> ''
           and g.group_id = m.group_id
           and g.is_programme_deleted = true
    ''')
    print(f'  [flag] curriculum.modules: {cursor.rowcount} row(s) marked from deleted groups')


def apply_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'programmes') or not column_exists(cursor, 'programmes', 'programme_id'):
            print('  [skip] curriculum.programmes absent; programme-deleted flags not backfilled')
            return

        ready_tables = [table for table in TABLES if add_deleted_flag(cursor, table)]
        for table in ready_tables:
            mark_orphaned_programmes(cursor, table)
        if 'groups' in ready_tables and 'modules' in ready_tables:
            mark_modules_for_deleted_groups(cursor)


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        for table in TABLES:
            if not table_exists(cursor, table):
                continue
            cursor.execute(f'drop index if exists curriculum."curriculum_{table}_programme_deleted_idx"')
            cursor.execute(f'alter table {qualified(table)} drop column if exists is_programme_deleted')
            print(f'  [drop] curriculum.{table}: is_programme_deleted removed if present')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0038_programme_foreign_keys'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
