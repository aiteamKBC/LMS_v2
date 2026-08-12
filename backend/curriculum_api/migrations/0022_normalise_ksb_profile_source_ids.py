from django.db import migrations


TABLES = ('modules', 'programmes')


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


def normalise_profile_source_ids(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for table in TABLES:
            if not table_exists(cursor, connection, table) or not column_exists(cursor, connection, table, 'ksb_profile_source_id'):
                continue
            if connection.vendor == 'postgresql':
                cursor.execute(
                    f'''
                    update {table_name(connection, table)}
                    set ksb_profile_source_id = regexp_replace(ksb_profile_source_id, '^(profile|framework):', '', 'i')
                    where ksb_profile_source_id ~* '^(profile|framework):'
                    '''
                )
            else:
                cursor.execute(
                    f'''
                    update {table_name(connection, table)}
                    set ksb_profile_source_id = substr(ksb_profile_source_id, instr(ksb_profile_source_id, ':') + 1)
                    where lower(ksb_profile_source_id) like 'profile:%'
                       or lower(ksb_profile_source_id) like 'framework:%'
                    '''
                )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0021_drop_module_coach_name'),
    ]

    operations = [
        migrations.RunPython(normalise_profile_source_ids, migrations.RunPython.noop),
    ]

