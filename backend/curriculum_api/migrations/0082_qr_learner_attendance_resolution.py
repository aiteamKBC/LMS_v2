"""Track QR and Teams evidence behind the final learner attendance outcome."""
from django.db import migrations, models


def add_evidence_columns(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            ADD COLUMN attendance_basis varchar(16) NOT NULL DEFAULT 'teams',
            ADD COLUMN teams_attendance_status varchar(16),
            ADD COLUMN attendance_source_occurrence_id varchar(128),
            ADD COLUMN qr_attendance_id bigint,
            ADD COLUMN qr_confirmed_at timestamptz''')
        cursor.execute('''UPDATE curriculum.live_session_learner_attendance
            SET teams_attendance_status=attendance_status,
                attendance_source_occurrence_id=occurrence_id''')
        cursor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            ADD CONSTRAINT curriculum_live_learner_attendance_basis_valid
                CHECK (attendance_basis IN ('teams','qr','teams_qr','staff')),
            ADD CONSTRAINT curriculum_live_learner_teams_status_valid
                CHECK (teams_attendance_status IS NULL OR teams_attendance_status IN ('present','absent')),
            ADD CONSTRAINT curriculum_live_learner_qr_attendance_fk
                FOREIGN KEY (qr_attendance_id) REFERENCES curriculum.qr_attendance(id) ON DELETE RESTRICT''')
        cursor.execute('''CREATE INDEX curriculum_live_learner_attendance_qr_idx
            ON curriculum.live_session_learner_attendance(qr_attendance_id)
            WHERE qr_attendance_id IS NOT NULL''')
        cursor.execute('''INSERT INTO curriculum.live_session_learner_attendance AS register (
                occurrence_id,live_session_id,module_catalogue_id,
                learner_profile_id,learner_email,learner_name,
                attendance_status,recovery_status,attended_seconds,attendance_report_id,
                calculated_at,attendance_basis,teams_attendance_status,
                attendance_source_occurrence_id,qr_attendance_id,qr_confirmed_at
            )
            SELECT q.occurrence_id,o.live_session_id,q.module_id,
                   p.id,p.email,p.full_name,
                   'present','none',0,'',q.confirmed_at,'qr',NULL,
                   q.occurrence_id,q.id,q.confirmed_at
            FROM curriculum.qr_attendance q
            JOIN "Learner".learners p ON p.enrolment_id=q.enrolment_id
            JOIN curriculum.live_session_occurrences o ON o.id=q.occurrence_id
            WHERE NOT EXISTS (
                SELECT 1 FROM "Learner".learners duplicate
                WHERE duplicate.enrolment_id=p.enrolment_id AND duplicate.id<>p.id
            )
            ON CONFLICT ON CONSTRAINT curriculum_live_learner_attendance_uniq DO UPDATE SET
                attendance_status=CASE
                    WHEN register.attendance_basis='staff' THEN register.attendance_status
                    ELSE 'present' END,
                attendance_basis=CASE
                    WHEN register.attendance_basis='staff' THEN 'staff'
                    WHEN register.teams_attendance_status='present' THEN 'teams_qr'
                    ELSE 'qr' END,
                attendance_source_occurrence_id=EXCLUDED.attendance_source_occurrence_id,
                qr_attendance_id=EXCLUDED.qr_attendance_id,
                qr_confirmed_at=EXCLUDED.qr_confirmed_at,
                calculated_at=GREATEST(register.calculated_at,EXCLUDED.calculated_at),
                updated_at=CURRENT_TIMESTAMP''')


def remove_evidence_columns(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('''DELETE FROM curriculum.live_session_learner_attendance
            WHERE qr_attendance_id IS NOT NULL AND teams_attendance_status IS NULL
              AND attendance_basis='qr' ''')
        cursor.execute('''UPDATE curriculum.live_session_learner_attendance
            SET attendance_status=teams_attendance_status
            WHERE qr_attendance_id IS NOT NULL AND teams_attendance_status IS NOT NULL
              AND attendance_basis IN ('qr','teams_qr')''')
        cursor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            DROP COLUMN qr_confirmed_at,
            DROP COLUMN qr_attendance_id,
            DROP COLUMN attendance_source_occurrence_id,
            DROP COLUMN teams_attendance_status,
            DROP COLUMN attendance_basis''')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0081_merge_free_courses_qr_attendance')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(add_evidence_columns, remove_evidence_columns)],
        state_operations=[
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='attendance_basis',
                field=models.CharField(default='teams', max_length=16),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='teams_attendance_status',
                field=models.CharField(blank=True, max_length=16, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='attendance_source_occurrence_id',
                field=models.CharField(blank=True, max_length=128, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='qr_attendance_id',
                field=models.BigIntegerField(blank=True, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='qr_confirmed_at',
                field=models.DateTimeField(blank=True, null=True),
            ),
        ],
    )]
