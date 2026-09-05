from django.db import DatabaseError
from django.http import JsonResponse

from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS
from .identity import learner_profile_for_source
from .teams_attendance import fetch_verified_teams_attendance_rows


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

    def row_status(row):
        s = status(row)
        if s == 'absent':
            return 'missed'
        if s == 'late' or (row['minutes_late'] or 0) > 0:
            return 'late'
        return 'attended'

    session_history = [
        {
            'id': f"{row.get('session_id', '')}-{row['session_date'].isoformat()}",
            'date': row['session_date'].isoformat(),
            'title': row.get('session_title', '') or '',
            'sessionType': row.get('session_type', '') or '',
            'status': row_status(row),
            'startTime': row['session_start_time'].strftime('%H:%M') if row.get('session_start_time') else '',
            'endTime': row['session_end_time'].strftime('%H:%M') if row.get('session_end_time') else '',
            'module': row.get('module_title', '') or '',
            'coach': row.get('coach_name', '') or '',
        }
        for row in latest_first
    ]

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
        'source': 'microsoft-teams',
        'sessionHistory': session_history,
    }


@learner_self_or_staff(kwarg="learner_id")
def learner_attendance(request, kind, learner_id):
    if request.method != 'GET':
        return _error('Method not allowed.', 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Unknown learner kind. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        # all_learners: the default manager is scoped to apprenticeship rows.
        source = model.all_learners.only('id', 'email').get(pk=learner_id)
    except model.DoesNotExist:
        return _error('Learner not found.', 404)
    except DatabaseError as exc:
        return _error(f'Database error: {exc}', 502)

    try:
        mirror = learner_profile_for_source(source, learner_id)
        email = (mirror.email if mirror else source.email) or ''
        rows = fetch_verified_teams_attendance_rows([learner_id], [email])
    except DatabaseError as exc:
        return _error(f'Unable to load attendance: {exc}', 502)

    return JsonResponse({'attendance': _summarize_attendance(rows)})
