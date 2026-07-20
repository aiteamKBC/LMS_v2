from django.db import migrations


RENAMES = [
    ('training_plan_program_configs', 'programmes'),
    ('module_authoring_modules', 'modules'),
    ('module_authoring_components', 'components'),
]


def rename_tables(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('create schema if not exists curriculum')
        for old_name, new_name in RENAMES:
            cursor.execute(
                '''
                select to_regclass(%s), to_regclass(%s)
                ''',
                [f'curriculum.{old_name}', f'curriculum.{new_name}'],
            )
            old_exists, new_exists = cursor.fetchone()
            if old_exists and not new_exists:
                cursor.execute(
                    f'alter table curriculum.{old_name} rename to {new_name}'
                )


def reverse_rename_tables(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for old_name, new_name in reversed(RENAMES):
            cursor.execute(
                '''
                select to_regclass(%s), to_regclass(%s)
                ''',
                [f'curriculum.{old_name}', f'curriculum.{new_name}'],
            )
            old_exists, new_exists = cursor.fetchone()
            if new_exists and not old_exists:
                cursor.execute(
                    f'alter table curriculum.{new_name} rename to {old_name}'
                )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0002_training_plan_module_catalogue_link'),
    ]

    operations = [
        migrations.RunPython(rename_tables, reverse_rename_tables),
    ]
