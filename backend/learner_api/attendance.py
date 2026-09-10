import hashlib
import os

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from django.db import DatabaseError
from django.http import JsonResponse

from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS


DEFAULT_KBC_ATTENDANCE_DATABASE = 'AiTeamKBC'


def _error(message, status):
    return JsonResponse({'error': message}, status=status)


def _risk_from_rate(rate):
    if rate >= 90:
        return 'green'
    if rate >= 80:
        return 'amber'
    return 'red'


def _kbc_attendance_connection_string():
    """Connection string for the live KBC attendance database.

    ``KBC_ATTENDANCE_DATABASE_URL`` is the explicit form used by Django's
    optional database alias. Older deployments expose the server-wide
    ``KBCDATABASE`` value instead, so retain that supported path and select the
    AiTeamKBC database on it.
    """
    direct = os.environ.get('KBC_ATTENDANCE_DATABASE_URL', '').strip()
    if direct:
        return direct

    server = os.environ.get('KBCDATABASE', '').strip()
    if not server:
        return ''
    conninfo = conninfo_to_dict(server)
    conninfo['dbname'] = os.environ.get(
        'KBC_ATTENDANCE_DATABASE',
        DEFAULT_KBC_ATTENDANCE_DATABASE,
    )
    return make_conninfo(**conninfo)


def _normalize_kbc_attendance_row(row, *, learner_id, learner_name, learner_email):
    attendance_value = row.get('Attendance')
    raw_status = str(row.get('attendance_status') or '').strip().lower()
    status = 'late' if raw_status == 'late' and attendance_value == 1 else (
        'present' if attendance_value == 1 else 'absent'
    )
    session_date = row.get('date')
    source_key = str(row.get('key') or '').strip()
    module = str(row.get('module') or '').strip()
    lecture = str(row.get('lecture_name') or '').strip()
    fallback_key = '|'.join((
        str(learner_id),
        session_date.isoformat() if session_date else '',
        module,
        lecture,
    ))
    fallback_digest = hashlib.sha256(fallback_key.encode('utf-8')).hexdigest()[:20]
    return {
        'learner_id': learner_id,
        'learner_name': learner_name,
        'learner_email': learner_email,
        # The report-absence workflow sends this identifier back later, so the
        # fallback must remain stable across requests (row order is not an ID).
        'session_id': source_key or f'kbc-attendance-{fallback_digest}',
        'session_date': session_date,
        'attendance_status': status,
        'minutes_late': 0,
        'catchup_completed': False,
        'updated_at': row.get('updated_at'),
        'session_title': lecture or module or 'Attendance session',
        'session_type': 'KBC attendance',
        'session_start_time': None,
        'session_end_time': None,
        'module_title': module,
        'coach_name': '',
    }


def fetch_kbc_attendance_rows(*, aptem_id, learner_id, learner_name, learner_email):
    """Read one learner's live register rows from AiTeamKBC.

    Aptem ID is the canonical cross-system identity. Email is only used when an
    enrolment has no Aptem ID; mixing both predicates could accidentally merge
    two people's records when stale source data contains a reused email.
    """
    dsn = _kbc_attendance_connection_string()
    if not dsn:
        raise RuntimeError('KBC attendance database is not configured.')

    aptem_key = str(aptem_id or '').strip()
    email_key = str(learner_email or '').strip().lower()
    if not aptem_key and not email_key:
        return []

    if aptem_key:
        identity_sql = '"ID"::text = %s'
        identity_param = aptem_key
    else:
        identity_sql = 'lower(trim("Email")) = %s'
        identity_param = email_key

    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                f'''
                SELECT "key", "date", "Attendance", attendance_status,
                       module, lecture_name, created_at AS updated_at
                FROM public.kbc_attendance
                WHERE {identity_sql}
                  AND "Attendance" IN (0, 1)
                  AND "date" IS NOT NULL
                ORDER BY "date" DESC, "key"
                ''',
                [identity_param],
            )
            return [
                _normalize_kbc_attendance_row(
                    row,
                    learner_id=learner_id,
                    learner_name=learner_name,
                    learner_email=learner_email,
                )
                for row in cursor.fetchall()
            ]


def _summarize_attendance(rows):
    """Convert the KBC register's session-per-row data into the learner summary."""
    def status(row):
        return (row['attendance_status'] or '').strip().lower()

    # Late is a display distinction only: it counts as attended in both the
    # numerator and denominator. Non-attendance workflow states (for example a
    # legacy ``catchup`` row) do not silently dilute the attendance rate.
    counted_rows = [row for row in rows if status(row) in {'present', 'late', 'absent'}]
    if not counted_rows:
        return None

    sessions = len(counted_rows)
    present = sum(status(row) in {'present', 'late'} for row in counted_rows)
    absent = sum(status(row) == 'absent' for row in counted_rows)
    late = sum(
        status(row) == 'late' or (row['minutes_late'] or 0) > 0
        for row in counted_rows
    )
    catchup = sum(bool(row['catchup_completed']) for row in counted_rows)
    attendance_rate = round((present / sessions) * 100) if sessions else 0

    latest_first = sorted(counted_rows, key=lambda row: row['session_date'], reverse=True)
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
        'source': 'kbc-attendance',
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
        source = model.all_learners.only('id', 'username', 'email', 'aptem_id').get(pk=learner_id)
    except model.DoesNotExist:
        return _error('Learner not found.', 404)
    except DatabaseError as exc:
        return _error(f'Database error: {exc}', 502)

    try:
        rows = fetch_kbc_attendance_rows(
            aptem_id=getattr(source, 'aptem_id', None),
            learner_id=source.id,
            learner_name=getattr(source, 'username', '') or '',
            learner_email=getattr(source, 'email', '') or '',
        )
    except Exception:
        return _error('Unable to load attendance from KBC.', 502)

    return JsonResponse({'attendance': _summarize_attendance(rows)})
