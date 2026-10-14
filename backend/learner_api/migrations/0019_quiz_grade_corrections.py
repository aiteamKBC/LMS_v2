from django.db import migrations


def create_correction_ledger(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute('''
            CREATE TABLE "Learner".learner_quiz_grade_corrections (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                progress_id bigint NOT NULL,
                correction_key text NOT NULL,
                plan_digest text NOT NULL,
                reason text NOT NULL,
                before_state jsonb NOT NULL,
                after_state jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                UNIQUE (progress_id, correction_key)
            )
        ''')


class Migration(migrations.Migration):
    dependencies = [("learner_api", "0018_quiz_result_snapshot")]
    # Deliberately irreversible: rolling back application code must not erase
    # the original grades and the evidence supporting a historical correction.
    operations = [migrations.RunPython(
        create_correction_ledger, hints={"learner_schema_migration": True},
    )]
