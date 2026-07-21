from django.db import DatabaseError, connection
from django.http import JsonResponse

from .learner_detail import SOURCE_MODELS


def _error(message, status):
    return JsonResponse({'error': message}, status=status)


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

    columns = [
        'learner_email', 'learner_id', 'learner_name', 'sessions', 'present',
        'absent', 'late', 'catchup', 'risk', 'last_session_date',
        'consecutive_missed', 'updated_at',
    ]
    try:
        with connection.cursor() as cursor:
            row = None
            if source.email:
                cursor.execute(
                    'SELECT * FROM "Learner"."Absence" WHERE lower(learner_email) = lower(%s) LIMIT 1',
                    [source.email.strip()],
                )
                row = cursor.fetchone()
            if row is None:
                cursor.execute(
                    'SELECT * FROM "Learner"."Absence" WHERE learner_id = %s LIMIT 1',
                    [learner_id],
                )
                row = cursor.fetchone()
    except DatabaseError as exc:
        return _error(f'Unable to load attendance: {exc}', 502)

    if row is None:
        return JsonResponse({'attendance': None})

    data = dict(zip(columns, row))
    sessions = data['sessions'] or 0
    present = data['present'] or 0
    attendance_rate = round((present / sessions) * 100) if sessions else 0
    return JsonResponse({
        'attendance': {
            'learnerEmail': data['learner_email'],
            'learnerId': data['learner_id'],
            'learnerName': data['learner_name'],
            'sessions': sessions,
            'present': present,
            'absent': data['absent'] or 0,
            'late': data['late'] or 0,
            'catchup': data['catchup'] or 0,
            'risk': (data['risk'] or '').lower(),
            'lastSessionDate': data['last_session_date'].isoformat() if data['last_session_date'] else None,
            'consecutiveMissed': data['consecutive_missed'] or 0,
            'updatedAt': data['updated_at'].isoformat() if data['updated_at'] else None,
            'attendanceRate': attendance_rate,
        }
    })
