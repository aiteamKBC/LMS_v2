from django.db import migrations


RETIRED_TYPES = ('workplace_evidence', 'workplace-evidence')


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
        return bool(cursor.fetchone()[0])
    cursor.execute("select name from sqlite_master where type='table' and name=%s", [table])
    return bool(cursor.fetchone())


def remove_workplace_evidence_components(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if not table_exists(cursor, connection, 'components'):
            return

        placeholders = ', '.join(['%s'] * len(RETIRED_TYPES))
        cursor.execute(
            f'select id from {table_name(connection, "components")} where type in ({placeholders})',
            list(RETIRED_TYPES),
        )
        component_ids = [row[0] for row in cursor.fetchall()]
        if not component_ids:
            return

        component_placeholders = ', '.join(['%s'] * len(component_ids))
        if table_exists(cursor, connection, 'ksb_mappings'):
            cursor.execute(
                f'delete from {table_name(connection, "ksb_mappings")} where component_id in ({component_placeholders})',
                component_ids,
            )
        cursor.execute(
            f'delete from {table_name(connection, "components")} where id in ({component_placeholders})',
            component_ids,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0006_backfill_curriculum_parent_relationships'),
    ]

    operations = [
        migrations.RunPython(remove_workplace_evidence_components, migrations.RunPython.noop),
    ]
