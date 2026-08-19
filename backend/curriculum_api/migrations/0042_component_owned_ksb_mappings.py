from django.db import migrations


def qualified(table):
    return f'curriculum."{table}"'


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


def recreate_lineage_views(cursor):
    required = {'components', 'weeks', 'modules', 'groups', 'cohorts', 'programmes', 'ksb_mappings'}
    if any(not table_exists(cursor, table) for table in required):
        return

    cursor.execute('drop view if exists curriculum.component_learning_summary')
    cursor.execute('drop view if exists curriculum.component_ksb_weighting')
    cursor.execute('drop view if exists curriculum.component_learning_lineage')

    cursor.execute('''
        create view curriculum.component_learning_lineage as
        select
            c.id as component_id,
            c.title as component_title,
            c.type as component_type,
            c.expected_otjh,
            c.points,
            c.ksb_mappings,
            c.reflection_required,
            c.workplace_evidence_required,
            c.tutor_validation_required,
            c.deleted_at as component_deleted_at,
            c.deleted_by as component_deleted_by,
            c.deleted_via_parent as component_deleted_via_parent,
            w.id as week_id,
            w.week_number,
            w.title as week_title,
            w.deleted_at as week_deleted_at,
            w.deleted_via_parent as week_deleted_via_parent,
            m.module_catalogue_id,
            m.title as module_title,
            m.group_id,
            m.group_name,
            m.cohort_id,
            m.cohort_name,
            m.programme_id,
            coalesce(p.name, m.programme_name) as programme_name,
            coalesce(p.is_archived, false) as programme_is_archived,
            p.deleted_at as programme_deleted_at,
            (
                c.deleted_at is not null
                or w.deleted_at is not null
                or m.deleted_at is not null
                or g.deleted_at is not null
                or ch.deleted_at is not null
                or p.deleted_at is not null
                or coalesce(c.is_programme_deleted, false)
                or coalesce(w.is_programme_deleted, false)
                or coalesce(m.is_programme_deleted, false)
                or coalesce(g.is_programme_deleted, false)
                or coalesce(ch.is_programme_deleted, false)
                or coalesce(p.is_archived, false)
            ) as is_deleted
        from curriculum.components c
        left join curriculum.weeks w on w.id = c.week_id
        left join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
        left join curriculum.groups g on g.group_id = m.group_id
        left join curriculum.cohorts ch on ch.cohort_id = m.cohort_id
        left join curriculum.programmes p on p.programme_id = m.programme_id
    ''')

    cursor.execute('''
        create view curriculum.component_ksb_weighting as
        select
            lineage.component_id,
            lineage.component_title,
            lineage.week_id,
            lineage.week_number,
            lineage.week_title,
            lineage.module_catalogue_id,
            lineage.module_title,
            lineage.group_id,
            lineage.group_name,
            lineage.cohort_id,
            lineage.cohort_name,
            lineage.programme_id,
            lineage.programme_name,
            km.id as mapping_id,
            km.ksb_id,
            km.ksb_code,
            km.ksb_description,
            km.source_type,
            km.source_id,
            km.classification,
            km.weight_class,
            km.weight as ksb_weight,
            (lineage.is_deleted or km.deleted_at is not null or coalesce(km.is_programme_deleted, false)) as is_deleted
        from curriculum.component_learning_lineage lineage
        left join curriculum.ksb_mappings km on km.component_id = lineage.component_id
    ''')

    cursor.execute('''
        create view curriculum.component_learning_summary as
        select
            lineage.*,
            coalesce(sum((mapping.value->>'weight')::numeric), 0) as ksb_weight_total,
            count(mapping.value) as ksb_mapping_count,
            coalesce(jsonb_agg(mapping.value order by mapping.value->>'code') filter (where mapping.value is not null), '[]'::jsonb) as component_ksb_mappings
        from curriculum.component_learning_lineage lineage
        left join lateral jsonb_array_elements(coalesce(lineage.ksb_mappings, '[]'::jsonb)) mapping(value) on true
        group by
            lineage.component_id,
            lineage.component_title,
            lineage.component_type,
            lineage.expected_otjh,
            lineage.points,
            lineage.ksb_mappings,
            lineage.reflection_required,
            lineage.workplace_evidence_required,
            lineage.tutor_validation_required,
            lineage.component_deleted_at,
            lineage.component_deleted_by,
            lineage.component_deleted_via_parent,
            lineage.week_id,
            lineage.week_number,
            lineage.week_title,
            lineage.week_deleted_at,
            lineage.week_deleted_via_parent,
            lineage.module_catalogue_id,
            lineage.module_title,
            lineage.group_id,
            lineage.group_name,
            lineage.cohort_id,
            lineage.cohort_name,
            lineage.programme_id,
            lineage.programme_name,
            lineage.programme_is_archived,
            lineage.programme_deleted_at,
            lineage.is_deleted
    ''')


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        try:
            cursor.execute('set default_transaction_read_only = off')
        except Exception:
            pass
        cursor.execute('drop view if exists curriculum.component_learning_summary')
        cursor.execute('drop view if exists curriculum.component_ksb_weighting')
        cursor.execute('drop view if exists curriculum.component_learning_lineage')
        if table_exists(cursor, 'components'):
            cursor.execute(f'''
                alter table {qualified('components')}
                add column if not exists ksb_mappings jsonb not null default '[]'::jsonb
            ''')
            cursor.execute(f'''
                alter table {qualified('components')}
                drop constraint if exists curriculum_components_ksb_mappings_array_chk
            ''')
            cursor.execute(f'''
                alter table {qualified('components')}
                add constraint curriculum_components_ksb_mappings_array_chk
                check (jsonb_typeof(ksb_mappings) = 'array')
            ''')
            cursor.execute(f'''
                alter table {qualified('components')}
                drop constraint if exists curriculum_components_ksb_weight_class_chk
            ''')
            cursor.execute(f'''
                alter table {qualified('components')}
                add constraint curriculum_components_ksb_weight_class_chk
                check (
                    not jsonb_path_exists(
                        coalesce(ksb_mappings, '[]'::jsonb),
                        '$[*] ? (!exists(@.weight_class) || !(@.weight_class == "hard" || @.weight_class == "soft" || @.weight_class == "possible"))'
                    )
                )
            ''')
            if table_exists(cursor, 'ksb_mappings'):
                cursor.execute(f'''
                    alter table {qualified('ksb_mappings')}
                    add column if not exists weight_class varchar(32) not null default 'soft'
                ''')
                cursor.execute(f'''
                    update {qualified('ksb_mappings')}
                       set weight_class = case
                           when lower(coalesce(weight_class, '')) in ('hard', 'soft', 'possible')
                               then lower(weight_class)
                           when lower(coalesce(classification, '')) = 'possible'
                               then 'possible'
                           when lower(coalesce(classification, '')) = 'main'
                               then 'hard'
                           else 'soft'
                       end
                     where weight_class is null
                        or lower(weight_class) not in ('hard', 'soft', 'possible')
                ''')
                cursor.execute(f'''
                    alter table {qualified('ksb_mappings')}
                    drop constraint if exists curriculum_ksb_mappings_weight_class_chk
                ''')
                cursor.execute(f'''
                    alter table {qualified('ksb_mappings')}
                    add constraint curriculum_ksb_mappings_weight_class_chk
                    check (weight_class in ('hard', 'soft', 'possible'))
                ''')
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
                               and deleted_at is null
                               and coalesce(is_programme_deleted, false) = false
                             group by component_id
                      ) mapped
                     where c.id = mapped.component_id
                       and coalesce(c.ksb_mappings, '[]'::jsonb) = '[]'::jsonb
                ''')
            cursor.execute(f'alter table {qualified("components")} drop column if exists weight_class')
            cursor.execute(f'alter table {qualified("components")} drop column if exists weight')
        recreate_lineage_views(cursor)


def revert_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('drop view if exists curriculum.component_learning_summary')
        cursor.execute('drop view if exists curriculum.component_ksb_weighting')
        cursor.execute('drop view if exists curriculum.component_learning_lineage')
        if table_exists(cursor, 'components'):
            cursor.execute(f'alter table {qualified("components")} drop constraint if exists curriculum_components_ksb_weight_class_chk')
            cursor.execute(f'alter table {qualified("components")} drop constraint if exists curriculum_components_ksb_mappings_array_chk')
            cursor.execute(f'alter table {qualified("components")} add column if not exists weight numeric(8,2)')
            cursor.execute(f'alter table {qualified("components")} add column if not exists weight_class varchar(64)')
            cursor.execute(f'alter table {qualified("components")} drop column if exists ksb_mappings')
        if table_exists(cursor, 'ksb_mappings'):
            cursor.execute(f'alter table {qualified("ksb_mappings")} drop constraint if exists curriculum_ksb_mappings_weight_class_chk')
            cursor.execute(f'alter table {qualified("ksb_mappings")} drop column if exists weight_class')


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('curriculum_api', '0041_curriculum_deleted_at_and_component_weight'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
