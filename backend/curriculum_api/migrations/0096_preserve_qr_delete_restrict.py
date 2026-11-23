"""Preserve QR RESTRICT ownership and the installed deletion cleanup trigger.

Frozen baseline of the approved independent architecture (2026-11-23).
SELECT-only: no repair, provisioning, historical backfill or reverse rewrite.
Requires a pre-provisioned canonical PostgreSQL schema. Empty databases fail
closed; these replacements are NOT a bootstrap for the externally owned LMS.
Run preflight explicitly even when the original migration is recorded: Django
then skips this replacement's operations. See migration_reconciliation.md.
"""
from django.db import migrations, models
import django.utils.timezone


# Catalog-only contract: no learner values. Function fingerprints deliberately
# fail on definition drift; review it instead of silently replacing a function.
CHECKS = [('QR RESTRICT foreign key',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) AND '
  "conname='curriculum_live_learner_qr_attendance_fk' ORDER BY conname",
  ('curriculum.live_session_learner_attendance',),
  [('curriculum_live_learner_qr_attendance_fk',
    'FOREIGN KEY (qr_attendance_id) REFERENCES curriculum.qr_attendance(id) ON DELETE RESTRICT',
    True)]),
 ('QR cleanup trigger',
  'SELECT tgname,pg_get_triggerdef(oid),tgenabled FROM pg_trigger\n'
  'WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal AND tgname=%s ORDER BY tgname',
  ('curriculum.qr_attendance', 'qr_attendance_delete_cleanup'),
  [('qr_attendance_delete_cleanup',
    'CREATE TRIGGER qr_attendance_delete_cleanup AFTER DELETE ON curriculum.qr_attendance FOR EACH ROW '
    'EXECUTE FUNCTION curriculum.qr_attendance_delete_cleanup()',
    'O')]),
 ('QR cleanup function',
  'SELECT md5(pg_get_functiondef(to_regprocedure(%s)))',
  ('curriculum.qr_attendance_delete_cleanup()',),
  [('9857481c9349dc34350b866285034a57',)])]


def validate(apps, schema_editor):
    database = schema_editor.connection
    if database.vendor != 'postgresql' or database.alias != 'default':
        raise RuntimeError('Canonical PostgreSQL default schema required; no bootstrap is provided.')
    with database.cursor() as cursor:
        for label, sql, params, expected in CHECKS:
            cursor.execute(sql, params)
            if cursor.fetchall() != expected:
                raise RuntimeError('Canonical baseline mismatch: ' + label +
                                   '. Preserve data and reconcile explicitly; do not replay the replaced migration.')


class Migration(migrations.Migration):
    replaces = [('curriculum_api', '0085_qr_attendance_delete_cleanup')]
    dependencies = [('curriculum_api', '0084_parallel_attendance_source')]
    operations = [migrations.RunPython(validate), migrations.SeparateDatabaseAndState(
        state_operations=[],
    )]
