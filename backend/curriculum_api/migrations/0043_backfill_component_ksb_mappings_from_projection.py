from django.db import migrations


def qualified(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        try:
            cursor.execute('set default_transaction_read_only = off')
        except Exception:
            pass
        if not table_exists(cursor, 'components') or not table_exists(cursor, 'ksb_mappings'):
            return
        cursor.execute(f'''
            update {qualified('components')} c
               set ksb_mappings = mapped.mappings
              from (
                    select component_id,
                           jsonb_agg(
                               jsonb_build_object(
                                   'id', id,
                                   'ksb_id', coalesce(ksb_id, ksb_code),
                                   'ksb_code', ksb_code,
                                   'description', coalesce(ksb_description, ''),
                                   'source_type', coalesce(source_type, ''),
                                   'source_id', coalesce(source_id, ''),
                                   'classification', classification,
                                   'weight', weight,
                                   'weight_class', weight_class
                               )
                               order by ksb_code, id
                           ) as mappings
                      from {qualified('ksb_mappings')}
                     where component_id is not null
                       and component_id <> ''
                     group by component_id
              ) mapped
             where c.id = mapped.component_id
               and coalesce(c.ksb_mappings, '[]'::jsonb) = '[]'::jsonb
        ''')


def revert_schema(apps, schema_editor):
    # Do not erase canonical component mappings on rollback; the old projection
    # rows remain present, but clearing component JSON would destroy authored
    # data that may have been edited after this migration.
    return


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('curriculum_api', '0042_component_owned_ksb_mappings'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
