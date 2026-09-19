"""Isolated persistence. Schema is explicitly installed; never created at runtime.

No enrolment, official learner, calendar, audit-hours or Teams tables are written.
"""
import json
from contextlib import contextmanager
from django.db import connections, transaction

TABLE = '"Learner".personal_course_enrolments'


def json_value(value, expected):
    """Raw PostgreSQL cursors may return JSON text instead of decoded values."""
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, expected):
        raise ValueError('The saved personal course record could not be read.')
    return value


def list_courses(account_id):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'SELECT module_id, created_at FROM {TABLE} WHERE account_id=%s ORDER BY created_at DESC', [account_id])
        return [{'moduleId': row[0], 'joinedAt': row[1].isoformat()} for row in cursor.fetchall()]


def enrol(account_id, module_id):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'INSERT INTO {TABLE} (account_id,module_id) VALUES (%s,%s) ON CONFLICT (account_id,module_id) DO NOTHING', [account_id, module_id])


def load(account_id, module_id, *, lock=False):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'SELECT progress,submissions,evidence FROM {TABLE} WHERE account_id=%s AND module_id=%s' + (' FOR UPDATE' if lock else ''), [account_id, module_id])
        row = cursor.fetchone()
    if not row:
        raise LookupError('Join this course before saving your progress.')
    return {'progress': json_value(row[0], list), 'submissions': json_value(row[1], dict), 'evidence': json_value(row[2], dict)}


@contextmanager
def edit(account_id, module_id):
    with transaction.atomic(using='enrolment'):
        state = load(account_id, module_id, lock=True)
        yield state
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(f'UPDATE {TABLE} SET progress=%s::jsonb,submissions=%s::jsonb,evidence=%s::jsonb,updated_at=now() WHERE account_id=%s AND module_id=%s',
                           [json.dumps(state['progress']), json.dumps(state['submissions']), json.dumps(state.get('evidence', {})), account_id, module_id])
