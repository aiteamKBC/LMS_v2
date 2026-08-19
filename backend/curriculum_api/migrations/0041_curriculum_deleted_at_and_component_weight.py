from django.db import migrations


CURRICULUM_TABLES = (
    'programmes',
    'cohorts',
    'groups',
    'modules',
    'weeks',
    'components',
    'ksb_mappings',
    'module_completion_criteria',
    'module_details',
)


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


def add_delete_columns(cursor, table):
    if not table_exists(cursor, table):
        return
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_at timestamp with time zone
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_by varchar(255)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_via_parent varchar(255)
    ''')
    cursor.execute(f'''
        create index if not exists curriculum_{table}_deleted_at_idx
        on {qualified(table)} (deleted_at)
    ''')


def backfill_deleted_columns(cursor, table):
    if not table_exists(cursor, table) or not column_exists(cursor, table, 'deleted_at'):
        return
    if column_exists(cursor, table, 'is_programme_deleted'):
        cursor.execute(f'''
            update {qualified(table)}
               set deleted_at = coalesce(deleted_at, current_timestamp),
                   deleted_by = coalesce(deleted_by, 'legacy:is_programme_deleted'),
                   deleted_via_parent = coalesce(deleted_via_parent, 'legacy:programme')
             where is_programme_deleted = true
               and deleted_at is null
        ''')
    if table == 'programmes' and column_exists(cursor, table, 'is_archived'):
        cursor.execute(f'''
            update {qualified(table)}
               set deleted_at = coalesce(deleted_at, current_timestamp),
                   deleted_by = coalesce(deleted_by, 'legacy:is_archived')
             where coalesce(is_archived, false) = true
               and deleted_at is null
        ''')


def add_component_weight_columns(cursor):
    if not table_exists(cursor, 'components'):
        return
    cursor.execute(f'''
        alter table {qualified('components')}
        add column if not exists weight numeric(8,2)
    ''')
    cursor.execute(f'''
        alter table {qualified('components')}
        add column if not exists weight_class varchar(64)
    ''')
    cursor.execute(f'''
        create index if not exists curriculum_components_weight_class_idx
        on {qualified('components')} (weight_class)
        where weight_class is not null and weight_class <> ''
    ''')


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
            c.weight,
            c.weight_class,
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
            lineage.weight as component_weight,
            lineage.weight_class as component_weight_class,
            km.id as mapping_id,
            km.ksb_id,
            km.ksb_code,
            km.ksb_description,
            km.source_type,
            km.source_id,
            km.classification as ksb_weight_class,
            km.weight as ksb_weight,
            (lineage.is_deleted or km.deleted_at is not null or coalesce(km.is_programme_deleted, false)) as is_deleted
        from curriculum.component_learning_lineage lineage
        left join curriculum.ksb_mappings km on km.component_id = lineage.component_id
    ''')

    cursor.execute('''
        create view curriculum.component_learning_summary as
        select
            lineage.*,
            coalesce(sum(km.weight) filter (where km.component_id is not null), 0) as ksb_weight_total,
            count(km.id) filter (where km.component_id is not null) as ksb_mapping_count,
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'mappingId', km.id,
                        'ksbId', km.ksb_id,
                        'code', km.ksb_code,
                        'description', km.ksb_description,
                        'sourceType', km.source_type,
                        'sourceId', km.source_id,
                        'classification', km.classification,
                        'weight', km.weight
                    )
                    order by km.ksb_code, km.id
                ) filter (where km.id is not null),
                '[]'::jsonb
            ) as ksb_mappings
        from curriculum.component_learning_lineage lineage
        left join curriculum.ksb_mappings km
          on km.component_id = lineage.component_id
         and km.deleted_at is null
         and coalesce(km.is_programme_deleted, false) = false
        group by
            lineage.component_id,
            lineage.component_title,
            lineage.component_type,
            lineage.expected_otjh,
            lineage.points,
            lineage.weight,
            lineage.weight_class,
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
        for table in CURRICULUM_TABLES:
            add_delete_columns(cursor, table)
        add_component_weight_columns(cursor)
        for table in CURRICULUM_TABLES:
            backfill_deleted_columns(cursor, table)
        recreate_lineage_views(cursor)


def revert_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('drop view if exists curriculum.component_learning_summary')
        cursor.execute('drop view if exists curriculum.component_ksb_weighting')
        cursor.execute('drop view if exists curriculum.component_learning_lineage')
        if table_exists(cursor, 'components'):
            cursor.execute('drop index if exists curriculum.curriculum_components_weight_class_idx')
            cursor.execute(f'alter table {qualified("components")} drop column if exists weight_class')
            cursor.execute(f'alter table {qualified("components")} drop column if exists weight')
        for table in reversed(CURRICULUM_TABLES):
            if not table_exists(cursor, table):
                continue
            cursor.execute(f'drop index if exists curriculum."curriculum_{table}_deleted_at_idx"')
            cursor.execute(f'alter table {qualified(table)} drop column if exists deleted_via_parent')
            cursor.execute(f'alter table {qualified(table)} drop column if exists deleted_by')
            cursor.execute(f'alter table {qualified(table)} drop column if exists deleted_at')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0040_component_lineage_and_soft_delete_flags'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
