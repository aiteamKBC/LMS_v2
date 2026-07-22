from django.db import DatabaseError, connection
from django.http import JsonResponse

from .learner_detail import SOURCE_MODELS


ATTENDANCE_TABLE = '"Coach"."learner_attendance_details"'


def _error(message, status):
    return JsonResponse({'error': message}, status=status)


def _risk_from_rate(rate):
    if rate >= 90:
        return 'green'
    if rate >= 80:
        return 'amber'
    return 'red'


def _summarize_attendance(rows):
    """Convert the session-per-row attendance table into the learner summary."""
    if not rows:
        return None

    def status(row):
        return (row['attendance_status'] or '').strip().lower()

    sessions = len(rows)
    present = sum(status(row) in {'present', 'late'} for row in rows)
    absent = sum(status(row) == 'absent' for row in rows)
    late = sum(status(row) == 'late' or (row['minutes_late'] or 0) > 0 for row in rows)
    catchup = sum(bool(row['catchup_completed']) for row in rows)
    attendance_rate = round((present / sessions) * 100) if sessions else 0

    latest_first = sorted(rows, key=lambda row: row['session_date'], reverse=True)
    consecutive_missed = 0
    for row in latest_first:
        if status(row) != 'absent':
            break
        consecutive_missed += 1

    latest = latest_first[0]
    updated_values = [row['updated_at'] for row in rows if row['updated_at']]
    updated_at = max(updated_values) if updated_values else None

    return {
        'learnerEmail': latest['learner_email'],
        'learnerId': latest['learner_id'],
        'learnerName': latest['learner_name'],
        'sessions': sessions,
        'present': present,
        'absent': absent,
        'late': late,
        'catchup': catchup,
        'risk': _risk_from_rate(attendance_rate),
        'lastSessionDate': latest['session_date'].isoformat(),
        'consecutiveMissed': consecutive_missed,
        'updatedAt': updated_at.isoformat() if updated_at else None,
        'attendanceRate': attendance_rate,
    }


def _fetch_rows(cursor, where_clause, params):
    cursor.execute(
        f'''
            SELECT learner_id, learner_name, learner_email, session_date,
                   attendance_status, minutes_late, catchup_completed, updated_at
            FROM {ATTENDANCE_TABLE}
            WHERE {where_clause}
            ORDER BY session_date DESC, id DESC
        ''',
        params,
    )
    columns = [column.name for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def learner_attendance(request, kind, learner_id):
    if request.method != 'GET':
        return _error('Method not allowed.', 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Unknown learner kind. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        source = model.objects.only('id', 'email').get(pk=learner_id)
    except model.DoesNotExist:
        return _error('Learner not found.', 404)
    except DatabaseError as exc:
        return _error(f'Database error: {exc}', 502)

    try:
        with connection.cursor() as cursor:
            rows = []
            if source.email and source.email.strip():
                rows = _fetch_rows(
                    cursor,
                    'lower(trim(learner_email)) = lower(trim(%s))',
                    [source.email],
                )
            if not rows:
                rows = _fetch_rows(cursor, 'learner_id = %s', [learner_id])
    except DatabaseError as exc:
        return _error(f'Unable to load attendance: {exc}', 502)

    return JsonResponse({'attendance': _summarize_attendance(rows)})
