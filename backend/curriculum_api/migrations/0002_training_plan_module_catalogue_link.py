from django.db import migrations


def add_training_plan_module_catalogue_link(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('create schema if not exists curriculum')
        cursor.execute(
            'alter table if exists curriculum."Training_plan" '
            'add column if not exists module_catalogue_id varchar(128)'
        )
        cursor.execute('''
            create index if not exists curriculum_training_plan_module_catalogue_idx
            on curriculum."Training_plan" (module_catalogue_id)
        ''')


def remove_training_plan_module_catalogue_link(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('drop index if exists curriculum.curriculum_training_plan_module_catalogue_idx')
        cursor.execute(
            'alter table if exists curriculum."Training_plan" '
            'drop column if exists module_catalogue_id'
        )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0001_ksb_mapping_source_metadata'),
    ]

    operations = [
        migrations.RunPython(
            add_training_plan_module_catalogue_link,
            remove_training_plan_module_catalogue_link,
        ),
    ]
