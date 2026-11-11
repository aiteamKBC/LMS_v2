"""Track which alternative delivery satisfied an assigned lecture."""
from django.db import migrations, models


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        ADD COLUMN IF NOT EXISTS parallel_source_occurrence_id varchar(128),
        ADD COLUMN IF NOT EXISTS parallel_source_module_id varchar(128),
        ADD COLUMN IF NOT EXISTS parallel_previous_status varchar(16),
        ADD COLUMN IF NOT EXISTS parallel_previous_basis varchar(16),
        ADD COLUMN IF NOT EXISTS parallel_created boolean NOT NULL DEFAULT false''')
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        DROP CONSTRAINT IF EXISTS curriculum_live_learner_attendance_basis_valid,
        ADD CONSTRAINT curriculum_live_learner_attendance_basis_valid
            CHECK (attendance_basis IN ('teams','qr','teams_qr','staff','parallel'))''')
    schema_editor.execute('''DO $body$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='curriculum_live_parallel_source_occurrence_fk') THEN
                ALTER TABLE curriculum.live_session_learner_attendance
                    ADD CONSTRAINT curriculum_live_parallel_source_occurrence_fk
                    FOREIGN KEY (parallel_source_occurrence_id)
                    REFERENCES curriculum.live_session_occurrences(id) ON DELETE RESTRICT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='curriculum_live_parallel_source_pair_valid') THEN
                ALTER TABLE curriculum.live_session_learner_attendance
                    ADD CONSTRAINT curriculum_live_parallel_source_pair_valid
                    CHECK ((parallel_source_occurrence_id IS NULL) = (parallel_source_module_id IS NULL));
            END IF;
        END
        $body$''')
    schema_editor.execute('''CREATE UNIQUE INDEX curriculum_live_parallel_source_unique
        ON curriculum.live_session_learner_attendance (learner_profile_id, parallel_source_occurrence_id)
        WHERE parallel_source_occurrence_id IS NOT NULL''')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0082_qr_learner_attendance_resolution'),
        ('curriculum_api', '0083_merge_web_points_qr_attendance'),
    ]
    # Irreversible: rolling back must not silently erase attendance provenance.
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(install)],
        state_operations=[
            migrations.AddField(model_name='livesessionlearnerattendance', name='parallel_source_occurrence_id',
                                field=models.CharField(max_length=128, null=True, blank=True)),
            migrations.AddField(model_name='livesessionlearnerattendance', name='parallel_source_module_id',
                                field=models.CharField(max_length=128, null=True, blank=True)),
            migrations.AddField(model_name='livesessionlearnerattendance', name='parallel_previous_status',
                                field=models.CharField(max_length=16, null=True, blank=True)),
            migrations.AddField(model_name='livesessionlearnerattendance', name='parallel_previous_basis',
                                field=models.CharField(max_length=16, null=True, blank=True)),
            migrations.AddField(model_name='livesessionlearnerattendance', name='parallel_created',
                                field=models.BooleanField(default=False)),
        ],
    )]
