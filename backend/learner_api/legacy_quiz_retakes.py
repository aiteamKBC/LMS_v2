"""Single-use learner/course/quiz grants, separate from imported history."""
from django.db import connections
from old_otjh.service import ServiceError

GRANTS = '"Learner".legacy_quiz_retake_grants'


def available(cursor, enrolment_id, aptem_id, group_id, quiz_id):
    cursor.execute('SELECT to_regclass(%s)', [GRANTS])
    if not cursor.fetchone()[0]:
        return None
    cursor.execute(f'''SELECT id FROM {GRANTS}
        WHERE enrolment_id=%s AND aptem_id=%s AND group_id=%s AND quiz_id=%s
          AND used_attempt_id IS NULL ORDER BY granted_at,id LIMIT 1''',
        [enrolment_id, aptem_id, group_id, quiz_id])
    row = cursor.fetchone()
    return str(row[0]) if row else None


def allowed(enrolment_id, aptem_id, group_id, quiz_id):
    with connections['enrolment'].cursor() as cursor:
        return available(cursor, enrolment_id, aptem_id, group_id, quiz_id) is not None


def consume(cursor, grant_id, enrolment_id, aptem_id, group_id, quiz_id, attempt_id):
    cursor.execute(f'''UPDATE {GRANTS} SET used_attempt_id=%s,used_at=CURRENT_TIMESTAMP
        WHERE id=%s AND enrolment_id=%s AND aptem_id=%s AND group_id=%s AND quiz_id=%s
          AND used_attempt_id IS NULL RETURNING id''',
        [attempt_id, grant_id, enrolment_id, aptem_id, group_id, quiz_id])
    if cursor.fetchone() is None:
        raise ServiceError('This additional quiz attempt is no longer available.', 'quiz_retake_used', 409)
