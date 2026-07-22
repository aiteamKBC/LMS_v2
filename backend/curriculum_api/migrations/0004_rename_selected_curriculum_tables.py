from django.db import migrations


RENAMES = [
    ('cohort_authoring_details', 'cohorts'),
    ('module_authoring_weeks', 'weeks'),
    ('module_authoring_ksb_mappings', 'ksb_mappings'),
    ('module_authoring_completion_criteria', 'module_completion_criteria'),
    ('module_authoring_advanced_details', 'module_details'),
    ('skills_england_ksbs', 'standard_ksbs'),
    ('training_plan_holidays', 'holidays'),
]


def rename_tables(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for old_name, new_name in RENAMES:
            cursor.execute(
                'select to_regclass(%s), to_regclass(%s)',
                [f'curriculum.{old_name}', f'curriculum.{new_name}'],
            )
            old_exists, new_exists = cursor.fetchone()
            if old_exists and not new_exists:
                cursor.execute(f'alter table curriculum."{old_name}" rename to "{new_name}"')


def reverse_rename_tables(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for old_name, new_name in reversed(RENAMES):
            cursor.execute(
                'select to_regclass(%s), to_regclass(%s)',
                [f'curriculum.{old_name}', f'curriculum.{new_name}'],
            )
            old_exists, new_exists = cursor.fetchone()
            if new_exists and not old_exists:
                cursor.execute(f'alter table curriculum."{new_name}" rename to "{old_name}"')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0003_rename_clear_curriculum_tables'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(rename_tables, reverse_rename_tables),
            ],
            state_operations=[
                migrations.AlterModelTable(
                    name='moduleauthoringweek',
                    table='curriculum"."weeks',
                ),
                migrations.AlterModelTable(
                    name='moduleauthoringksbmapping',
                    table='curriculum"."ksb_mappings',
                ),
                migrations.AlterModelTable(
                    name='moduleauthoringcompletioncriteria',
                    table='curriculum"."module_completion_criteria',
                ),
                migrations.AlterModelTable(
                    name='moduleauthoringadvanceddetails',
                    table='curriculum"."module_details',
                ),
                migrations.AlterModelTable(
                    name='cohortauthoringdetails',
                    table='curriculum"."cohorts',
                ),
            ],
        ),
    ]
