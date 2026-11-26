"""Prepare monthly actual storage without populating it or changing readers.

The progress FK also includes learner_id, so a valid target ID cannot link
another learner's activity. Reporting-month/programme selection and aggregation
remain the responsibility of the later write integration: the reporting month
used by Monthly Logs can differ from the original stored reporting_month.

No default zero, backfill, aggregation trigger, polling or startup hook is added.
These externally managed tables may be prepared before this migration is marked
applied; repeated installation verifies the existing definitions and keeps data.
"""
import re

from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError


TARGET = '"Learner".learner_monthly_targets'
PROGRESS = '"Learner".learner_progress_entries'
COLUMNS = (
    (TARGET, 'actual_seconds_total', 'bigint'),
    (TARGET, 'actual_updated_at', 'timestamp with time zone'),
    (PROGRESS, 'monthly_target_id', 'bigint'),
)
CONSTRAINTS = (
    (TARGET, 'learner_monthly_actual_seconds_nonnegative',
     'CHECK (actual_seconds_total IS NULL OR actual_seconds_total >= 0)', True),
    (TARGET, 'learner_monthly_actual_state_complete',
     'CHECK ((actual_seconds_total IS NULL) = (actual_updated_at IS NULL))', True),
    (TARGET, 'learner_monthly_targets_id_learner_uniq',
     'UNIQUE (id, learner_id)', False),
    (PROGRESS, 'learner_progress_monthly_target_owner_fk',
     f'FOREIGN KEY (monthly_target_id, learner_id) REFERENCES {TARGET} (id, learner_id) '
     'ON DELETE RESTRICT', True),
)
INDEX_NAME = 'learner_progress_monthly_target_idx'
INDEX_SQL = (f'CREATE INDEX {INDEX_NAME} ON {PROGRESS} USING btree (monthly_target_id) '
             'WHERE monthly_target_id IS NOT NULL')


def _normalise(definition):
    return re.sub(r'[\s()]', '', definition).removesuffix('NOTVALID')


def _column(cursor, relation, name):
    cursor.execute('''SELECT format_type(a.atttypid,a.atttypmod),a.attnotnull,
            pg_get_expr(d.adbin,d.adrelid)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=to_regclass(%s) AND a.attname=%s AND NOT a.attisdropped''',
        [relation, name])
    return cursor.fetchone()


def _preflight(cursor):
    cursor.execute('SELECT to_regclass(%s),to_regclass(%s)', [TARGET, PROGRESS])
    relations = cursor.fetchone()
    if not any(relations):
        return False  # This installation has no externally managed learner ledger.
    if not all(relations):
        raise RuntimeError('Both monthly targets and progress entries must exist.')
    for relation in (TARGET, PROGRESS):
        for name in ('id', 'learner_id'):
            column = _column(cursor, relation, name)
            if column is None or column[:2] != ('bigint', True):
                raise RuntimeError(f'Unexpected key definition: {relation}.{name}.')
    source_seconds = _column(cursor, PROGRESS, 'actual_seconds')
    if source_seconds is None or source_seconds[:2] != ('bigint', False):
        raise RuntimeError('Verify the original progress actual_seconds type before migrating.')
    for relation, name, kind in COLUMNS:
        column = _column(cursor, relation, name)
        if column is not None and column != (kind, False, None):
            raise RuntimeError(f'Existing column has an unexpected definition: {relation}.{name}.')
    return True


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        if not _preflight(cursor):
            return
        for relation, name, kind in COLUMNS:
            if _column(cursor, relation, name) is None:
                cursor.execute(f'ALTER TABLE {relation} ADD COLUMN {name} {kind} NULL')
        for relation, name, definition, can_validate in CONSTRAINTS:
            cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated
                FROM pg_constraint WHERE conrelid=to_regclass(%s) AND conname=%s''',
                [relation, name])
            existing = cursor.fetchone()
            if existing and _normalise(existing[0]) != _normalise(definition):
                raise RuntimeError(f'Existing constraint has an unexpected definition: {name}.')
            if not existing:
                suffix = ' NOT VALID' if can_validate else ''
                cursor.execute(f'ALTER TABLE {relation} ADD CONSTRAINT {name} {definition}{suffix}')
            if can_validate and (not existing or not existing[1]):
                cursor.execute(f'ALTER TABLE {relation} VALIDATE CONSTRAINT {name}')
        cursor.execute('''SELECT pg_get_indexdef(i.indexrelid),i.indisvalid
            FROM pg_index i WHERE i.indexrelid=to_regclass(%s)''',
            [f'"Learner".{INDEX_NAME}'])
        existing = cursor.fetchone()
        if existing:
            if not existing[1] or _normalise(existing[0]) != _normalise(INDEX_SQL):
                raise RuntimeError(f'Existing index has an unexpected definition: {INDEX_NAME}.')
        else:
            cursor.execute(INDEX_SQL)


def uninstall(apps, schema_editor):
    """Rollback unused storage only; never discard populated summaries or links."""
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        if not _preflight(cursor):
            return
        cursor.execute(f'LOCK TABLE {TARGET}, {PROGRESS} IN ACCESS EXCLUSIVE MODE')
        for relation, name, _kind in COLUMNS:
            if _column(cursor, relation, name) is not None:
                cursor.execute(f'SELECT 1 FROM {relation} WHERE {name} IS NOT NULL LIMIT 1')
                if cursor.fetchone():
                    raise IrreversibleError('Monthly actual storage is in use; preserve its data and links.')
        cursor.execute(f'DROP INDEX IF EXISTS "Learner".{INDEX_NAME}')
        for relation, name, _definition, _can_validate in reversed(CONSTRAINTS):
            cursor.execute(f'ALTER TABLE {relation} DROP CONSTRAINT IF EXISTS {name}')
        for relation, name, _kind in reversed(COLUMNS):
            cursor.execute(f'ALTER TABLE {relation} DROP COLUMN IF EXISTS {name}')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0028_source_lms_alias_profile_aptem_integrity')]
    operations = [migrations.RunPython(
        install, uninstall, hints={'learner_schema_migration': True},
    )]
