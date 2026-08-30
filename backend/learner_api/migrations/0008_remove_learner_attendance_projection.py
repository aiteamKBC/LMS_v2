from django.db import migrations


def remove_projection(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        cursor.execute('drop table if exists "Learner"."learner_attendance"')


class Migration(migrations.Migration):
    dependencies = [
        ("learner_api", "0007_classify_and_repair_legacy_component_refs"),
    ]

    operations = [
        migrations.RunPython(
            remove_projection,
            migrations.RunPython.noop,
            hints={"learner_schema_migration": True},
        ),
    ]
