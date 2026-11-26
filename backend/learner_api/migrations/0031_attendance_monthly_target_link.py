"""Link resolved attendance to its learner/month target without changing hours.

The existing committed-event worker selects the current programme target and
maintains the links. No backfill, default target, timer or startup scan runs here.
"""
import importlib

from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError

base = importlib.import_module('learner_api.migrations.0029_monthly_actual_summary_storage')
ATTENDANCE = 'curriculum.live_session_learner_attendance'
FK = 'live_attendance_monthly_target_owner_fk'
DEFINITION = (f'FOREIGN KEY (monthly_target_id, learner_profile_id) REFERENCES {base.TARGET} '
              '(id, learner_id) ON DELETE RESTRICT')
INDEX = 'live_attendance_monthly_target_idx'
INDEX_SQL = (f'CREATE INDEX {INDEX} ON {ATTENDANCE} USING btree (monthly_target_id) '
             'WHERE monthly_target_id IS NOT NULL')


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        cursor.execute('SELECT to_regclass(%s),to_regclass(%s)', [ATTENDANCE, base.TARGET])
        relations = cursor.fetchone()
        if not any(relations):
            return
        if not all(relations):
            raise RuntimeError('Attendance and monthly targets must both exist.')
        for relation, column in ((ATTENDANCE, 'learner_profile_id'), (base.TARGET, 'id'), (base.TARGET, 'learner_id')):
            value = base._column(cursor, relation, column)
            if value is None or value[:2] != ('bigint', True):
                raise RuntimeError('Unexpected attendance/target owner key definition.')
        column = base._column(cursor, ATTENDANCE, 'monthly_target_id')
        if column is not None and column != ('bigint', False, None):
            raise RuntimeError('Unexpected existing attendance monthly_target_id definition.')
        if column is None:
            cursor.execute(f'ALTER TABLE {ATTENDANCE} ADD COLUMN monthly_target_id bigint NULL')
        cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid=to_regclass(%s) AND conname=%s''', [ATTENDANCE, FK])
        existing = cursor.fetchone()
        if existing and base._normalise(existing[0]) != base._normalise(DEFINITION):
            raise RuntimeError('Unexpected existing attendance monthly target FK.')
        if not existing:
            cursor.execute(f'ALTER TABLE {ATTENDANCE} ADD CONSTRAINT {FK} {DEFINITION} NOT VALID')
        if not existing or not existing[1]:
            cursor.execute(f'ALTER TABLE {ATTENDANCE} VALIDATE CONSTRAINT {FK}')
        cursor.execute('''SELECT pg_get_indexdef(indexrelid),indisvalid FROM pg_index
            WHERE indexrelid=to_regclass(%s)''', [f'curriculum.{INDEX}'])
        index = cursor.fetchone()
        if index is None:
            cursor.execute(INDEX_SQL)
        elif not index[1] or base._normalise(index[0]) != base._normalise(INDEX_SQL):
            raise RuntimeError('Unexpected existing attendance monthly target index.')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        if base._column(cursor, ATTENDANCE, 'monthly_target_id') is None:
            return
        cursor.execute(f'LOCK TABLE {ATTENDANCE} IN ACCESS EXCLUSIVE MODE')
        cursor.execute(f'SELECT 1 FROM {ATTENDANCE} WHERE monthly_target_id IS NOT NULL LIMIT 1')
        if cursor.fetchone():
            raise IrreversibleError('Attendance links are in use; preserve them.')
        cursor.execute(f'DROP INDEX IF EXISTS curriculum.{INDEX}')
        cursor.execute(f'ALTER TABLE {ATTENDANCE} DROP CONSTRAINT IF EXISTS {FK}')
        cursor.execute(f'ALTER TABLE {ATTENDANCE} DROP COLUMN monthly_target_id')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0030_monthly_actual_summary_events')]
    operations = [migrations.RunPython(install, uninstall, hints={'learner_schema_migration': True})]
