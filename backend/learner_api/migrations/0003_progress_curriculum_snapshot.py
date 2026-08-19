from django.db import migrations


def table_exists(cursor, relation):
    cursor.execute('select to_regclass(%s)', [relation])
    return bool(cursor.fetchone()[0])


def add_column(cursor, table, name, ddl):
    cursor.execute(f'alter table {table} add column if not exists {name} {ddl}')


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        progress_table = '"Learner"."learner_progress_entries"'
        ksb_table = '"Learner"."learner_progress_ksbs"'
        if table_exists(cursor, 'Learner.learner_progress_entries'):
            for name, ddl in (
                ('programme_ref', 'text'),
                ('programme_title', "text not null default ''"),
                ('cohort_ref', 'text'),
                ('cohort_title', "text not null default ''"),
                ('group_ref', 'text'),
                ('group_title', "text not null default ''"),
                ('expected_otjh', 'numeric(8,2)'),
                ('points', 'integer'),
            ):
                add_column(cursor, progress_table, name, ddl)
            cursor.execute(
                f'create index if not exists learner_progress_curriculum_scope_idx '
                f'on {progress_table} (programme_ref, group_ref, module_ref, component_ref)'
            )
            cursor.execute(
                f'create index if not exists learner_progress_component_ref_idx '
                f'on {progress_table} (component_ref)'
            )

        if table_exists(cursor, 'Learner.learner_progress_ksbs'):
            for name, ddl in (
                ('ksb_description', "text not null default ''"),
                ('source_type', "varchar(32) not null default ''"),
                ('source_id', "text not null default ''"),
                ('classification', "varchar(32) not null default ''"),
                ('weight', 'numeric(5,2)'),
            ):
                add_column(cursor, ksb_table, name, ddl)
            cursor.execute(
                f'create index if not exists learner_progress_ksbs_code_weight_idx '
                f'on {ksb_table} (ksb_code, classification)'
            )


def revert_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        progress_table = '"Learner"."learner_progress_entries"'
        ksb_table = '"Learner"."learner_progress_ksbs"'
        cursor.execute('drop index if exists "Learner".learner_progress_curriculum_scope_idx')
        cursor.execute('drop index if exists "Learner".learner_progress_component_ref_idx')
        cursor.execute('drop index if exists "Learner".learner_progress_ksbs_code_weight_idx')
        if table_exists(cursor, 'Learner.learner_progress_entries'):
            for name in (
                'points',
                'expected_otjh',
                'group_title',
                'group_ref',
                'cohort_title',
                'cohort_ref',
                'programme_title',
                'programme_ref',
            ):
                cursor.execute(f'alter table {progress_table} drop column if exists {name}')
        if table_exists(cursor, 'Learner.learner_progress_ksbs'):
            for name in ('weight', 'classification', 'source_id', 'source_type', 'ksb_description'):
                cursor.execute(f'alter table {ksb_table} drop column if exists {name}')


class Migration(migrations.Migration):
    dependencies = [
        ('learner_api', '0002_apprenticeshipagreement_ilrdocument_and_more'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
