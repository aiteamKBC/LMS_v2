"""Protect retained quiz answers after deploying compatible quiz writers.

Run only on the verified Development target for this delivery. NOT VALID
enforces new writes immediately, so compatible backend code must be in use
before applying this migration. No learner data is repaired or rewritten.
"""
from django.db import DatabaseError, connections, migrations, transaction


CONSTRAINT = 'learner_quiz_answers_question_ref_fkey'
SOURCE = '"Learner".learner_quiz_answers'
TARGET = 'curriculum.quiz_questions'
LOCK_TIMEOUT = '2s'
STATEMENT_TIMEOUT = '60s'


def _identity(connection):
    config = connection.settings_dict
    return (config['ENGINE'], config['NAME'],
            str(config.get('HOST') or '').lower().replace('-pooler.', '.'),
            str(config.get('PORT') or 5432))


def _timeouts(cursor):
    # Transaction-local settings work through a transaction pooler and are
    # restored on commit/rollback; do not leak timeout changes to application IO.
    cursor.execute("SELECT set_config('lock_timeout', %s, true), "
                   "set_config('statement_timeout', %s, true)",
                   [LOCK_TIMEOUT, STATEMENT_TIMEOUT])


def _schema(cursor):
    for table, column in ((SOURCE, 'question_ref'), (TARGET, 'id')):
        cursor.execute('''SELECT a.attnum FROM pg_attribute a
            JOIN pg_class t ON t.oid=a.attrelid
            WHERE a.attrelid=to_regclass(%s) AND a.attname=%s
              AND NOT a.attisdropped AND a.atttypid='pg_catalog.int8'::regtype
              AND t.relkind='r' ''', [table, column])
        if cursor.fetchone() is None:
            raise RuntimeError(f'Quiz FK preflight: expected BIGINT {table}.{column} on an ordinary table.')
    cursor.execute('''SELECT 1 FROM pg_index i
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
        WHERE i.indrelid=%s::regclass AND a.attname='id'
          AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnkeyatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL''', [TARGET])
    if cursor.fetchone() is None:
        raise RuntimeError('Quiz FK preflight: quiz_questions.id needs a valid unique key.')
    cursor.execute('''SELECT 1 FROM pg_index i
        JOIN pg_class ix ON ix.oid=i.indexrelid
        JOIN pg_am am ON am.oid=ix.relam
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
        WHERE i.indrelid=%s::regclass AND a.attname='question_ref'
          AND am.amname='btree' AND i.indisvalid AND i.indisready
          AND i.indpred IS NULL AND i.indexprs IS NULL''', [SOURCE])
    if cursor.fetchone() is None:
        # Do not silently build a blocking index on a live answer table. The
        # known deployment already has this index; a missing one is a separate
        # concurrent-index prerequisite, not permission to change live data.
        raise RuntimeError('Quiz FK preflight: the existing question_ref index is missing or invalid; provision a concurrent index before retrying.')


def _constraint(cursor):
    cursor.execute('''SELECT c.conname, c.convalidated,
        c.contype='f' AND c.confrelid=to_regclass(%s)
        AND c.confupdtype='r' AND c.confdeltype='r' AND NOT c.condeferrable
        AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute
            WHERE attrelid=c.conrelid AND attname='question_ref')]::smallint[]
        AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute
            WHERE attrelid=c.confrelid AND attname='id')]::smallint[] AS exact
        FROM pg_constraint c WHERE c.conrelid=to_regclass(%s)
          AND (c.conname=%s OR (c.contype='f' AND
               (SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid
                AND attname='question_ref')=ANY(c.conkey)))''', [TARGET, SOURCE, CONSTRAINT])
    rows = cursor.fetchall()
    if not rows:
        return None
    if len(rows) != 1 or rows[0][0] != CONSTRAINT or rows[0][2] is not True:
        raise RuntimeError('Quiz FK preflight: an existing question_ref constraint differs from the requested definition; reconcile it before retrying.')
    return rows[0][1]


def _no_orphans(cursor):
    cursor.execute(f'''SELECT EXISTS(SELECT 1 FROM {SOURCE} a
        WHERE a.question_ref IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM {TARGET} q WHERE q.id=a.question_ref))''')
    if cursor.fetchone()[0]:
        raise RuntimeError('Quiz FK preflight: orphan question references exist; historical data was left unchanged. Resolve the blocker before retrying.')


def install(apps, schema_editor):
    database = schema_editor.connection
    if database.vendor != 'postgresql':
        return
    if database.alias != 'default' or _identity(database) != _identity(connections['enrolment']):
        raise RuntimeError('Quiz FK requires default and enrolment to target the same verified Development database.')
    if database.in_atomic_block:
        raise RuntimeError('Quiz FK migration must run non-atomically so ADD and VALIDATE release their locks separately.')
    try:
        # Compatibility checks precede DDL. Refuse discrepancies rather than
        # dropping/replacing a constraint or repairing learner history.
        with transaction.atomic(using=database.alias), database.cursor() as cursor:
            _timeouts(cursor)
            _schema(cursor)
            validated = _constraint(cursor)
            _no_orphans(cursor)
        if validated is True:
            return

        if validated is None:
            with transaction.atomic(using=database.alias), database.cursor() as cursor:
                _timeouts(cursor)
                # A second deploy may have finished while preflight ran.
                cursor.execute(f'LOCK TABLE {SOURCE}, {TARGET} IN SHARE ROW EXCLUSIVE MODE')
                validated = _constraint(cursor)
                if validated is None:
                    cursor.execute(f'''ALTER TABLE {SOURCE} ADD CONSTRAINT {CONSTRAINT}
                        FOREIGN KEY (question_ref) REFERENCES {TARGET}(id)
                        ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID''')

        # A failed validation leaves the exact NOT VALID constraint enforcing
        # new writes. A retry resumes validation; it does not recreate the FK.
        with transaction.atomic(using=database.alias), database.cursor() as cursor:
            _timeouts(cursor)
            _no_orphans(cursor)
            cursor.execute(f'ALTER TABLE {SOURCE} VALIDATE CONSTRAINT {CONSTRAINT}')
            if _constraint(cursor) is not True:
                raise RuntimeError('Quiz FK validation did not complete; inspect the constraint before retrying.')
    except DatabaseError as exc:
        cause = exc.__cause__
        if getattr(cause, 'sqlstate', getattr(cause, 'pgcode', None)) in {'55P03', '57014'}:
            raise RuntimeError('Quiz FK migration stopped at its lock/statement timeout. No learner rows were rewritten. An already-added NOT VALID FK is retained; retry in a quieter window.') from exc
        raise


class Migration(migrations.Migration):
    atomic = False
    dependencies = [('quiz_api', '0004_question_image'), ('learner_api', '0001_initial')]
    # Deliberately irreversible: rolling application code back must not silently
    # remove protection from retained answers. Any FK removal needs review.
    operations = [migrations.RunPython(install, atomic=False)]
