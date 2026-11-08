"""Link standalone catalogue tables to the existing learning/history identities.

The shared authoring rows remain the runtime identities used by learner plans.
No learner, completion or hours ledger is rewritten by this migration.
"""
from django.db import migrations


def apply_schema(apps, schema_editor):
    from curriculum_api.free_course_storage_schema import provision
    provision(schema_editor.connection)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0079_course_pricing')]
    operations = [migrations.RunPython(apply_schema, migrations.RunPython.noop)]
