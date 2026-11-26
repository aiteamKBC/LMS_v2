"""Retain optional, owner-checked links to preserved Old-LMS actual hours.

Schema only: no history backfill, application startup hook or data discovery.
Legacy learner IDs remain independent of current learner profile IDs.
"""
from django.db import migrations
from django.db.migrations.exceptions import IrreversibleError


OLD = '"Learner".source_lms_actual_hours'
SOURCES = '"Learner".learner_activity_sources'
LEARNERS = '"Learner".learners'
COLUMNS = {
    'legacy_actual_learner_id': 'bigint',
    'legacy_actual_kind': 'text',
    'legacy_actual_ref': 'text',
    'legacy_actual_aptem_id': 'bigint',
}
OLD_KEY = 'source_lms_actual_hours_identity_uniq'
ROW_FK = 'activity_source_legacy_actual_row_fk'
OWNER_FK = 'activity_source_legacy_actual_owner_fk'
INDEX = 'activity_source_legacy_actual_idx'
OLD_DEFINITION = 'UNIQUE (learner_id, kind, ref, aptem_id)'
ROW_DEFINITION = (
    f'FOREIGN KEY ({", ".join(COLUMNS)}) REFERENCES {OLD} '
    '(learner_id, kind, ref, aptem_id) MATCH FULL '
    'ON UPDATE RESTRICT ON DELETE RESTRICT'
)
OWNER_DEFINITION = (
    f'FOREIGN KEY (learner_id, legacy_actual_aptem_id) REFERENCES {LEARNERS} '
    '(id, aptem_id) ON UPDATE RESTRICT ON DELETE RESTRICT'
)
INDEX_SQL = (
    f'CREATE INDEX {INDEX} ON {SOURCES} USING btree ({", ".join(COLUMNS)}) '
    'WHERE (legacy_actual_learner_id IS NOT NULL)'
)


def _normalise(value):
    return ' '.join(value.replace('"', '').replace('(', ' ( ').replace(')', ' ) ').split())


def _columns(cursor, relation):
    cursor.execute('''SELECT a.attname,format_type(a.atttypid,a.atttypmod),
        a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attgenerated,a.attidentity
        FROM pg_attribute a LEFT JOIN pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped''', [relation])
    return {name: (kind, required, default, generated, identity)
            for name, kind, required, default, generated, identity in cursor.fetchall()}


def _constraint(cursor, relation, name):
    cursor.execute('''SELECT pg_get_constraintdef(oid),convalidated
        FROM pg_constraint WHERE conrelid=to_regclass(%s) AND conname=%s''', [relation, name])
    return cursor.fetchone()


def _ensure_constraint(cursor, relation, name, definition, *, foreign=False):
    existing = _constraint(cursor, relation, name)
    if existing and _normalise(existing[0].removesuffix(' NOT VALID')) != _normalise(definition):
        raise RuntimeError(f'Unexpected definition for {name}; no constraint was replaced.')
    if not existing:
        cursor.execute(f'ALTER TABLE {relation} ADD CONSTRAINT {name} {definition}'
                       + (' NOT VALID' if foreign else ''))
    if foreign and (not existing or not existing[1]):
        cursor.execute(f'ALTER TABLE {relation} VALIDATE CONSTRAINT {name}')


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        cursor.execute('SELECT to_regclass(%s),to_regclass(%s),to_regclass(%s)',
                       [OLD, SOURCES, LEARNERS])
        relations = cursor.fetchone()
        if not any(relations):
            return  # This installation has no externally managed learner schema.
        if not all(relations):
            raise RuntimeError('Legacy hours, activity sources and learners must all exist.')
        schemas = {relation: _columns(cursor, relation) for relation in (OLD, SOURCES, LEARNERS)}
        for relation, expected in (
            (OLD, {'learner_id': ('bigint', True), 'kind': ('text', True),
                   'ref': ('text', True), 'aptem_id': ('bigint', False)}),
            (SOURCES, {'learner_id': ('bigint', True)}),
            (LEARNERS, {'id': ('bigint', True), 'aptem_id': ('bigint', False)}),
        ):
            if any(schemas[relation].get(name, ())[:2] != value for name, value in expected.items()):
                raise RuntimeError('Unexpected learner/legacy identity column definitions.')
        # Existing identity uniqueness is a prerequisite, not an inferred mapping.
        for relation, key in ((OLD, ['learner_id', 'kind', 'ref']), (LEARNERS, ['id', 'aptem_id'])):
            cursor.execute('''SELECT EXISTS (
                SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass(%s)
                  AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
                  AND i.indexprs IS NULL AND i.indimmediate
                  AND ARRAY(SELECT a.attname FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,pos)
                      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
                      WHERE k.pos<=i.indnkeyatts ORDER BY k.pos)=%s::name[])''', [relation, key])
            if not cursor.fetchone()[0]:
                raise RuntimeError('Verified legacy and current learner unique keys are required.')
        for name, kind in COLUMNS.items():
            value = schemas[SOURCES].get(name)
            if value is not None and value != (kind, False, None, '', ''):
                raise RuntimeError(f'Unexpected existing {name} column; no data was overwritten.')
        _ensure_constraint(cursor, OLD, OLD_KEY, OLD_DEFINITION)
        for name, kind in COLUMNS.items():
            if name not in schemas[SOURCES]:
                cursor.execute(f'ALTER TABLE {SOURCES} ADD COLUMN {name} {kind} NULL')
        _ensure_constraint(cursor, SOURCES, ROW_FK, ROW_DEFINITION, foreign=True)
        _ensure_constraint(cursor, SOURCES, OWNER_FK, OWNER_DEFINITION, foreign=True)
        cursor.execute('''SELECT pg_get_indexdef(indexrelid),indisvalid FROM pg_index
            WHERE indexrelid=to_regclass(%s)''', [f'"Learner".{INDEX}'])
        index = cursor.fetchone()
        if index is None:
            cursor.execute(INDEX_SQL)
        elif not index[1] or _normalise(index[0]) != _normalise(INDEX_SQL):
            raise RuntimeError('Unexpected existing legacy actual-hours link index.')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='60s'")
        columns = _columns(cursor, SOURCES)
        if not any(name in columns for name in COLUMNS):
            return
        if not all(name in columns for name in COLUMNS):
            raise RuntimeError('Partial legacy link schema; preserve it for review.')
        cursor.execute(f'LOCK TABLE {SOURCES} IN ACCESS EXCLUSIVE MODE')
        condition = ' OR '.join(f'{name} IS NOT NULL' for name in COLUMNS)
        cursor.execute(f'SELECT 1 FROM {SOURCES} WHERE {condition} LIMIT 1')
        if cursor.fetchone():
            raise IrreversibleError('Legacy actual-hours links are in use; preserve their provenance.')
        cursor.execute(f'ALTER TABLE {SOURCES} DROP CONSTRAINT {OWNER_FK}')
        cursor.execute(f'ALTER TABLE {SOURCES} DROP CONSTRAINT {ROW_FK}')
        cursor.execute(f'DROP INDEX "Learner".{INDEX}')
        for name in COLUMNS:
            cursor.execute(f'ALTER TABLE {SOURCES} DROP COLUMN {name}')
        cursor.execute(f'ALTER TABLE {OLD} DROP CONSTRAINT {OLD_KEY}')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0032_subject_attempt_monthly_target_link')]
    operations = [migrations.RunPython(install, uninstall, hints={'learner_schema_migration': True})]
