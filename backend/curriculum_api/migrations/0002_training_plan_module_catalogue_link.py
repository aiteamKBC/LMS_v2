from django.db import migrations


def add_training_plan_module_catalogue_link(apps, schema_editor):
    return


def remove_training_plan_module_catalogue_link(apps, schema_editor):
    return


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
