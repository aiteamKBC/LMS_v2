from django.db import migrations, models


def add_result_snapshot(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            'ALTER TABLE "Learner".learner_quiz_answers '
            'ADD COLUMN IF NOT EXISTS result_snapshot jsonb NULL'
        )


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0017_quiz_question_image_snapshot")]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(
            add_result_snapshot, migrations.RunPython.noop,
            hints={"learner_schema_migration": True},
        )],
        state_operations=[migrations.AddField(
            model_name="learnerquizanswer", name="result_snapshot",
            field=models.JSONField(null=True, blank=True),
        )],
    )]
