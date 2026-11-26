"""Link persisted attempts to their owner's monthly target through write events.

Requires the canonical attempt learner_id already established by the source
identity schema. No attempts are imported and no learner backfill runs here.
"""
import importlib

from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError

base = importlib.import_module('learner_api.migrations.0029_monthly_actual_summary_storage')
events = importlib.import_module('learner_api.migrations.0030_monthly_actual_summary_events')
ATTEMPTS = '"Learner".subject_activity_attempts'
FK = 'subject_attempt_monthly_target_owner_fk'
DEFINITION = (f'FOREIGN KEY (monthly_target_id, learner_id) REFERENCES {base.TARGET} '
              '(id, learner_id) ON DELETE RESTRICT')
INDEX = 'subject_attempt_monthly_target_idx'
INDEX_SQL = (f'CREATE INDEX {INDEX} ON {ATTEMPTS} USING btree (monthly_target_id) '
             'WHERE monthly_target_id IS NOT NULL')
EVENT_INDEX = next(index for index, spec in enumerate(events.SPECS)
                   if spec[:2] == ('Learner', 'subject_activity_attempts'))
OLD_OWNER, OLD_FIELDS = events.SPECS[EVENT_INDEX][2:]


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        cursor.execute('SELECT to_regclass(%s),to_regclass(%s)', [ATTEMPTS, base.TARGET])
        relations = cursor.fetchone()
        if not any(relations):
            return
        if not all(relations):
            raise RuntimeError('Subject attempts and monthly targets must both exist.')
        for relation, column in ((ATTEMPTS, 'learner_id'), (base.TARGET, 'id'), (base.TARGET, 'learner_id')):
            value = base._column(cursor, relation, column)
            if value is None or value[:2] != ('bigint', True):
                raise RuntimeError('Canonical non-null learner keys are required before linking attempts.')
        cursor.execute('SELECT to_regprocedure(%s)', [f'"Learner".{events.PREFIX}{EVENT_INDEX}()'])
        if cursor.fetchone()[0] is None:
            raise RuntimeError('Committed monthly attempt events must be installed first.')
        column = base._column(cursor, ATTEMPTS, 'monthly_target_id')
        if column is not None and column != ('bigint', False, None):
            raise RuntimeError('Unexpected existing attempt monthly_target_id definition.')
        if column is None:
            cursor.execute(f'ALTER TABLE {ATTEMPTS} ADD COLUMN monthly_target_id bigint NULL')
        cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid=to_regclass(%s) AND conname=%s''', [ATTEMPTS, FK])
        existing = cursor.fetchone()
        if existing and base._normalise(existing[0]) != base._normalise(DEFINITION):
            raise RuntimeError('Unexpected existing attempt monthly target FK.')
        if not existing:
            cursor.execute(f'ALTER TABLE {ATTEMPTS} ADD CONSTRAINT {FK} {DEFINITION} NOT VALID')
        if not existing or not existing[1]:
            cursor.execute(f'ALTER TABLE {ATTEMPTS} VALIDATE CONSTRAINT {FK}')
        cursor.execute('''SELECT pg_get_indexdef(indexrelid),indisvalid FROM pg_index
            WHERE indexrelid=to_regclass(%s)''', [f'"Learner".{INDEX}'])
        index = cursor.fetchone()
        if index is None:
            cursor.execute(INDEX_SQL)
        elif not index[1] or base._normalise(index[0]) != base._normalise(INDEX_SQL):
            raise RuntimeError('Unexpected existing attempt monthly target index.')
        # Only replace this source's existing statement function. Include the
        # canonical owner even for attempts without legacy identity fields.
        # FK-only writes stay outside the event fields to prevent feedback.
        cursor.execute(events.definition(EVENT_INDEX,
            events.direct('learner_id') + ' UNION ' + OLD_OWNER, [*OLD_FIELDS, 'learner_id']))


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        if base._column(cursor, ATTEMPTS, 'monthly_target_id') is None:
            return
        cursor.execute(f'LOCK TABLE {ATTEMPTS} IN ACCESS EXCLUSIVE MODE')
        cursor.execute(f'SELECT 1 FROM {ATTEMPTS} WHERE monthly_target_id IS NOT NULL LIMIT 1')
        if cursor.fetchone():
            raise IrreversibleError('Attempt links are in use; preserve them.')
        cursor.execute(events.definition(EVENT_INDEX, OLD_OWNER, OLD_FIELDS))
        cursor.execute(f'DROP INDEX IF EXISTS "Learner".{INDEX}')
        cursor.execute(f'ALTER TABLE {ATTEMPTS} DROP CONSTRAINT IF EXISTS {FK}')
        cursor.execute(f'ALTER TABLE {ATTEMPTS} DROP COLUMN monthly_target_id')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0031_attendance_monthly_target_link')]
    operations = [migrations.RunPython(install, uninstall, hints={'learner_schema_migration': True})]
