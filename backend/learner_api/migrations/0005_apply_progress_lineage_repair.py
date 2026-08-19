import importlib

from django.db import migrations


def apply_schema(apps, schema_editor):
    repair = importlib.import_module("learner_api.migrations.0004_repair_progress_lineage_columns")
    repair.apply_schema(apps, schema_editor)


def revert_schema(apps, schema_editor):
    repair = importlib.import_module("learner_api.migrations.0004_repair_progress_lineage_columns")
    repair.revert_schema(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("learner_api", "0004_repair_progress_lineage_columns"),
    ]

    operations = [
        migrations.RunPython(
            apply_schema,
            revert_schema,
            hints={"learner_schema_migration": True},
        ),
    ]
