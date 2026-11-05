"""Retain each delivery's register when learners share a Teams occurrence."""
from django.db import migrations, models


def scope_register(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            DROP CONSTRAINT curriculum_live_learner_attendance_uniq,
            ADD CONSTRAINT curriculum_live_learner_attendance_uniq
            UNIQUE (occurrence_id, learner_profile_id, module_catalogue_id)''')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0071_attendance_identity_rules')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(scope_register)],
        state_operations=[
            migrations.AddConstraint('livesessionlearnerattendance', models.UniqueConstraint(
                fields=['occurrence_id', 'learner_profile_id', 'module_catalogue_id'],
                name='curriculum_live_learner_attendance_uniq')),
        ],
    )]
