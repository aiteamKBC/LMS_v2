"""Make direct QR evidence deletion clean up learner attendance provenance."""
from django.db import migrations


TRIGGER_SQL = r'''
CREATE OR REPLACE FUNCTION curriculum.qr_attendance_delete_cleanup()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    profile_id bigint;
BEGIN
    SELECT learner.id
    INTO profile_id
    FROM "Learner".learners learner
    WHERE learner.enrolment_id = OLD.enrolment_id
    ORDER BY learner.id
    LIMIT 1;

    IF profile_id IS NOT NULL THEN
        DELETE FROM curriculum.live_session_learner_attendance
        WHERE learner_profile_id = profile_id
          AND parallel_source_occurrence_id = OLD.occurrence_id
          AND parallel_source_module_id = OLD.module_id
          AND parallel_created = true;

        UPDATE curriculum.live_session_learner_attendance
        SET attendance_status = COALESCE(parallel_previous_status, 'absent'),
            attendance_basis = COALESCE(parallel_previous_basis, 'teams'),
            parallel_source_occurrence_id = NULL,
            parallel_source_module_id = NULL,
            parallel_previous_status = NULL,
            parallel_previous_basis = NULL,
            parallel_created = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE learner_profile_id = profile_id
          AND parallel_source_occurrence_id = OLD.occurrence_id
          AND parallel_source_module_id = OLD.module_id
          AND parallel_created = false
          AND attendance_basis = 'parallel';
    END IF;

    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS qr_attendance_delete_cleanup
ON curriculum.qr_attendance;

CREATE TRIGGER qr_attendance_delete_cleanup
AFTER DELETE ON curriculum.qr_attendance
FOR EACH ROW
EXECUTE FUNCTION curriculum.qr_attendance_delete_cleanup();
'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        DROP CONSTRAINT IF EXISTS curriculum_live_learner_qr_attendance_fk''')
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        ADD CONSTRAINT curriculum_live_learner_qr_attendance_fk
        FOREIGN KEY (qr_attendance_id)
        REFERENCES curriculum.qr_attendance(id)
        ON DELETE CASCADE''')
    schema_editor.execute(TRIGGER_SQL)


def remove(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('''DROP TRIGGER IF EXISTS qr_attendance_delete_cleanup
        ON curriculum.qr_attendance''')
    schema_editor.execute('''DROP FUNCTION IF EXISTS curriculum.qr_attendance_delete_cleanup()''')
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        DROP CONSTRAINT IF EXISTS curriculum_live_learner_qr_attendance_fk''')
    schema_editor.execute('''ALTER TABLE curriculum.live_session_learner_attendance
        ADD CONSTRAINT curriculum_live_learner_qr_attendance_fk
        FOREIGN KEY (qr_attendance_id)
        REFERENCES curriculum.qr_attendance(id)
        ON DELETE RESTRICT''')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0084_parallel_attendance_source')]
    operations = [migrations.RunPython(install, remove)]
