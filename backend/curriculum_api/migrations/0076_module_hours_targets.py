from django.db import migrations


def apply_schema(apps, schema_editor):
    from curriculum_api.module_hours_schema import provision
    provision(schema_editor.connection)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0075_teams_organization_calendar_connection')]
    operations = [migrations.RunPython(apply_schema, migrations.RunPython.noop)]
