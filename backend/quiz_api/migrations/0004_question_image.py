from django.db import migrations, models


def add_question_image(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            'ALTER TABLE curriculum.quiz_questions '
            "ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT ''"
        )


class Migration(migrations.Migration):
    dependencies = [("quiz_api", "0003_initial")]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[migrations.RunPython(add_question_image, migrations.RunPython.noop)],
            state_operations=[migrations.AddField(
                model_name="quizquestion", name="image_url",
                field=models.TextField(blank=True, default=""),
            )],
        ),
    ]
