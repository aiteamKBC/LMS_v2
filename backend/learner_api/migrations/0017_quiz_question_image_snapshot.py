from django.db import migrations, models


def add_image_snapshot(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            'ALTER TABLE "Learner".learner_quiz_answers '
            'ADD COLUMN IF NOT EXISTS question_image_url text NULL'
        )


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0016_ulnprivacyreviewdetail")]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(
            add_image_snapshot, migrations.RunPython.noop,
            hints={"learner_schema_migration": True},
        )],
        state_operations=[migrations.AddField(
            model_name="learnerquizanswer", name="question_image_url",
            field=models.TextField(null=True, blank=True),
        )],
    )]
