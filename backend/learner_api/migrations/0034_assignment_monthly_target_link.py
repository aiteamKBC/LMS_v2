"""Owner-checked assignment links; existing write events refresh their totals.

Additive schema only. No source times, marking, history or learner backfill is
changed here. The event consumer links submissions using canonical allocations.
"""
import importlib

from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError

base = importlib.import_module('learner_api.migrations.0029_monthly_actual_summary_storage')
events = importlib.import_module('learner_api.migrations.0030_monthly_actual_summary_events')
SUBMISSIONS = '"Learner".learning_reflection_submissions'
FK = 'assignment_monthly_target_owner_fk'
DEFINITION = (f'FOREIGN KEY (monthly_target_id, learner_id) REFERENCES {base.TARGET} '
              '(id, learner_id) ON DELETE RESTRICT')
INDEX = 'assignment_monthly_target_idx'
INDEX_SQL = (f'CREATE INDEX {INDEX} ON {SUBMISSIONS} USING btree (monthly_target_id) '
             'WHERE monthly_target_id IS NOT NULL')
EVENT_INDEX = next(index for index, spec in enumerate(events.SPECS)
                   if spec[:2] == ('Learner', 'learning_reflection_submissions'))


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        cursor.execute('SELECT to_regclass(%s),to_regclass(%s)', [SUBMISSIONS, base.TARGET])
        relations = cursor.fetchone()
        if not any(relations):
            return
        if not all(relations):
            raise RuntimeError('Submissions and monthly targets must both exist.')
        for relation, column in ((SUBMISSIONS, 'learner_id'), (base.TARGET, 'id'), (base.TARGET, 'learner_id')):
            value = base._column(cursor, relation, column)
            if value is None or value[:2] != ('bigint', True):
                raise RuntimeError('Canonical non-null learner keys are required before linking submissions.')
        if (base._column(cursor, SUBMISSIONS, 'id') or ())[:2] != ('uuid', True):
            raise RuntimeError('Submission UUID identities must already exist.')
        cursor.execute('''SELECT count(*) FROM pg_trigger
            WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal AND tgenabled='O'
              AND tgname=ANY(%s) AND tgfoid=to_regprocedure(%s)''',
            [SUBMISSIONS, [f'{events.PREFIX}{EVENT_INDEX}_{op}' for op in ('insert', 'update', 'delete')],
             f'"Learner".{events.PREFIX}{EVENT_INDEX}()'])
        if cursor.fetchone()[0] != 3:
            raise RuntimeError('Committed monthly submission events must be installed first.')
        column = base._column(cursor, SUBMISSIONS, 'monthly_target_id')
        if column is not None and column != ('bigint', False, None):
            raise RuntimeError('Unexpected existing submission monthly_target_id definition.')
        if column is None:
            cursor.execute(f'ALTER TABLE {SUBMISSIONS} ADD COLUMN monthly_target_id bigint NULL')
        cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid=to_regclass(%s) AND conname=%s''', [SUBMISSIONS, FK])
        existing = cursor.fetchone()
        if existing and base._normalise(existing[0].removesuffix(' NOT VALID')) != base._normalise(DEFINITION):
            raise RuntimeError('Unexpected existing assignment monthly target FK.')
        if not existing:
            cursor.execute(f'ALTER TABLE {SUBMISSIONS} ADD CONSTRAINT {FK} {DEFINITION} NOT VALID')
        if not existing or not existing[1]:
            cursor.execute(f'ALTER TABLE {SUBMISSIONS} VALIDATE CONSTRAINT {FK}')
        cursor.execute('''SELECT pg_get_indexdef(indexrelid),indisvalid FROM pg_index
            WHERE indexrelid=to_regclass(%s)''', [f'"Learner".{INDEX}'])
        index = cursor.fetchone()
        if index is None:
            cursor.execute(INDEX_SQL)
        elif not index[1] or base._normalise(index[0]) != base._normalise(INDEX_SQL):
            raise RuntimeError('Unexpected existing assignment monthly target index.')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        if base._column(cursor, SUBMISSIONS, 'monthly_target_id') is None:
            return
        cursor.execute(f'LOCK TABLE {SUBMISSIONS} IN ACCESS EXCLUSIVE MODE')
        cursor.execute(f'SELECT 1 FROM {SUBMISSIONS} WHERE monthly_target_id IS NOT NULL LIMIT 1')
        if cursor.fetchone():
            raise IrreversibleError('Assignment links are in use; preserve them.')
        cursor.execute(f'DROP INDEX IF EXISTS "Learner".{INDEX}')
        cursor.execute(f'ALTER TABLE {SUBMISSIONS} DROP CONSTRAINT IF EXISTS {FK}')
        cursor.execute(f'ALTER TABLE {SUBMISSIONS} DROP COLUMN monthly_target_id')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0033_source_lms_actual_hours_links')]
    operations = [migrations.RunPython(install, uninstall, hints={'learner_schema_migration': True})]
