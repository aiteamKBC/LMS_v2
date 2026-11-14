"""Optional web grouping; no changes to existing activities or progress."""
from django.db import migrations


def apply_schema(apps, schema_editor):
    from curriculum_api.web_week_points_schema import provision
    provision(schema_editor.connection)


class Migration(migrations.Migration):
    # Independent of QR attendance: this feature does not provision its tables.
    dependencies = [('curriculum_api', '0080_free_course_storage')]
    operations = [migrations.RunPython(apply_schema, migrations.RunPython.noop)]
