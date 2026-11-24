"""Bounded, database-only student speaking phase for the existing background worker."""
import logging

from django.db import connections, transaction


log = logging.getLogger(__name__)


def process_pending_speaking(*, limit=10, series_ids=None):
    """Retry speaking independently; never requeue Graph/archive work or call save-all.

    This must own its transaction: the snapshot procedure requires repeatable
    read, and SET TRANSACTION must run before the first database query.
    """
    connection = connections['default']
    if connection.in_atomic_block:
        raise RuntimeError('Speaking worker requires an independent transaction')
    scope = list(dict.fromkeys(str(value).strip() for value in (series_ids or []) if str(value).strip()))
    with transaction.atomic(using='default'), connection.cursor() as cursor:
        cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        cursor.execute("SET LOCAL statement_timeout = '60s'")
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        cursor.execute("SELECT set_config('lms.speaking_expected_database',current_database(),true)")
        cursor.execute('SELECT processed,completed,retrying FROM curriculum.process_new_session_student_speaking(%s,%s)',
                       [scope or None, max(1, min(int(limit), 100))])
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError('Speaking worker returned no processing status')
    return dict(zip(('processed', 'completed', 'retrying'), row))


def run_speaking_phase(*, limit=10, series_ids=None):
    """Isolate failures from the existing Teams job verdict, with a visible log."""
    try:
        status = process_pending_speaking(limit=limit, series_ids=series_ids)
        if status['processed']:
            log.info('Student speaking: %s completed; %s await retry.', status['completed'], status['retrying'])
        if status['retrying']:
            log.warning('Student speaking: %s jobs await retry; inspect curriculum.live_session_speaking_jobs.',
                        status['retrying'])
        return status
    except Exception as failure:
        # Log type only; database errors can contain learner values/SQL/secrets.
        log.warning('Student speaking phase unavailable (%s); retry on the next worker pass. Session sync outcomes unchanged.',
                    type(failure).__name__)
        return None
