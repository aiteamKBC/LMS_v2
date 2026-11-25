"""Reconcile historical 0049 without replaying identity guesses or deleting history.

Already-normalized installations are verified without writes. Legacy databases
must have valid, unique canonical references before this migration can run.
Ambiguous/orphaned data requires a separately reviewed normalization, never an
automatic name match or deletion. No shared database is migrated by this task.
"""
from django.db import migrations
from curriculum_api import tutor_notification_schema as schema


def forwards(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != 'postgresql':
        return
    with db.cursor() as cursor:
        cursor.execute("SELECT to_regclass('curriculum.tutor_module_notifications')")
        if cursor.fetchone()[0] is None:
            schema.create_table(cursor, db.vendor)
        else:
            cursor.execute("""SELECT data_type FROM information_schema.columns
                WHERE table_schema='curriculum' AND table_name='tutor_module_notifications'
                AND column_name='id'""")
            if cursor.fetchone()[0] != 'uuid':
                cursor.execute('LOCK TABLE curriculum.tutor_module_notifications IN ACCESS EXCLUSIVE MODE')
                cursor.execute('''SELECT EXISTS (
                    SELECT 1 FROM curriculum.tutor_module_notifications n
                    LEFT JOIN curriculum.tutors t ON t.id=n.tutor_id
                    LEFT JOIN curriculum.modules m ON m.module_catalogue_id=n.module_catalogue_id
                    WHERE t.id IS NULL OR m.module_catalogue_id IS NULL
                    UNION ALL
                    SELECT 1 FROM curriculum.tutor_module_notifications
                    GROUP BY tutor_id,module_catalogue_id HAVING count(*)>1)''')
                if cursor.fetchone()[0]:
                    raise RuntimeError('Notification normalization requires reviewed canonical references; no history was deleted.')
                cursor.execute('''ALTER TABLE curriculum.tutor_module_notifications
                    ALTER COLUMN id DROP DEFAULT,
                    ALTER COLUMN id TYPE uuid USING gen_random_uuid(),
                    ALTER COLUMN id SET DEFAULT gen_random_uuid(),
                    DROP COLUMN IF EXISTS tutor_key,
                    DROP COLUMN IF EXISTS tutor_name,
                    DROP COLUMN IF EXISTS tutor_email,
                    ADD CONSTRAINT uq_tutor_notification_module UNIQUE(tutor_id,module_catalogue_id),
                    ADD CONSTRAINT fk_tutor_notification_tutor FOREIGN KEY(tutor_id)
                        REFERENCES curriculum.tutors(id) ON DELETE RESTRICT,
                    ADD CONSTRAINT fk_tutor_notification_module FOREIGN KEY(module_catalogue_id)
                        REFERENCES curriculum.modules(module_catalogue_id) ON DELETE RESTRICT''')
        schema.verify(cursor, db.vendor)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0099_canonical_ksb_state')]
    operations = [migrations.RunPython(forwards)]
