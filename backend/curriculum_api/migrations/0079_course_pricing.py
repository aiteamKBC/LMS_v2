from django.db import migrations


def apply_schema(apps, schema_editor):
    from curriculum_api.course_pricing_schema import provision
    provision(schema_editor.connection)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0078_curriculum_video_changes')]
    # Additive: rolling application code back must retain recorded prices.
    operations = [migrations.RunPython(apply_schema, migrations.RunPython.noop)]
