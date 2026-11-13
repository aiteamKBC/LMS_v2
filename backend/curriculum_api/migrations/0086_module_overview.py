"""Add curriculum.modules.module_overview (nullable JSONB) for the Module Overview page."""
from django.db import migrations


def apply_schema(apps, schema_editor):
    from curriculum_api.module_overview_schema import provision
    provision(schema_editor.connection)


def remove_schema(apps, schema_editor):
    from curriculum_api.module_overview_schema import remove
    remove(schema_editor.connection)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0085_qr_attendance_delete_cleanup')]
    operations = [migrations.RunPython(apply_schema, remove_schema)]
