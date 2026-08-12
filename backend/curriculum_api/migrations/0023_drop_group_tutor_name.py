from django.db import migrations


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
        return bool(cursor.fetchone()[0])
    cursor.execute("select 1 from sqlite_master where type='table' and name=%s limit 1", [table])
    return bool(cursor.fetchone())


def column_exists(cursor, connection, table, column):
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
            ['curriculum', table, column],
        )
        return bool(cursor.fetchone())
    cursor.execute(f'pragma table_info({table_name(connection, table)})')
    return any(row[1] == column for row in cursor.fetchall())


def drop_group_tutor_name(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection, 'groups') or not column_exists(cursor, connection, 'groups', 'tutor_name'):
            return
        if table_exists(cursor, connection, 'modules') and column_exists(cursor, connection, 'modules', 'tutor_name'):
            if connection.vendor == 'postgresql':
                cursor.execute(
                    f'''
                    update {table_name(connection, 'modules')} module
                    set tutor_name = nullif(group_table.tutor_name, '')
                    from {table_name(connection, 'groups')} group_table
                    where module.group_id = group_table.group_id
                      and coalesce(nullif(module.tutor_name, ''), '') = ''
                      and coalesce(nullif(group_table.tutor_name, ''), '') <> ''
                    '''
                )
            else:
                cursor.execute(
                    f'''
                    update {table_name(connection, 'modules')}
                    set tutor_name = (
                        select nullif(group_table.tutor_name, '')
                        from {table_name(connection, 'groups')} group_table
                        where group_table.group_id = {table_name(connection, 'modules')}.group_id
                    )
                    where coalesce(nullif(tutor_name, ''), '') = ''
                      and exists (
                        select 1
                        from {table_name(connection, 'groups')} group_table
                        where group_table.group_id = {table_name(connection, 'modules')}.group_id
                          and coalesce(nullif(group_table.tutor_name, ''), '') <> ''
                      )
                    '''
                )
        cursor.execute(f'alter table {table_name(connection, "groups")} drop column "tutor_name"')


def restore_group_tutor_name(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if table_exists(cursor, connection, 'groups') and not column_exists(cursor, connection, 'groups', 'tutor_name'):
            cursor.execute(f'alter table {table_name(connection, "groups")} add column "tutor_name" varchar(255)')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0022_normalise_ksb_profile_source_ids'),
    ]

    operations = [
        migrations.RunPython(drop_group_tutor_name, restore_group_tutor_name),
    ]
