"""Live attendance reporting, independent of recorded learning completion."""
from datetime import datetime, time, timezone as utc

from django.db import DatabaseError, connections
from django.utils import timezone

from .attendance_rules import INVALID, attendance_outcome


PREFERENCES = '"Learner".attendance_preferences'
CHANGES = '"Learner".attendance_mode_changes'


def delivery_timeline(learner_id):
    """Only effective mode changes matter; pending requests do not change targets."""
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT to_regclass(%s), to_regclass(%s)', [PREFERENCES, CHANGES])
        preferences, changes = cursor.fetchone()
        if not preferences:
            return 'live', []
        if not changes:
            raise DatabaseError('Attendance mode history migration has not been applied.')
        cursor.execute(f'SELECT mode FROM {PREFERENCES} WHERE learner_id=%s', [learner_id])
        state = cursor.fetchone()
        cursor.execute(f'''SELECT previous_mode, mode, effective_at FROM {CHANGES}
            WHERE learner_id=%s ORDER BY effective_at, id''', [learner_id])
        events = cursor.fetchall()
    if state and state[0] == 'lazy' and not events:
        raise DatabaseError('Historical Recorded delivery needs a verified effective date before reporting attendance.')
    initial = events[0][0] if events else state[0] if state else 'live'
    return initial, [(at, mode) for _, mode, at in events]


def project_live_attendance(rows, timeline, *, now=None):
    """Keep historical live obligations; recorded periods add only actual visits.

    Excluded rows remain in the register so live/KBC overlap precedence is
    preserved. Recording completion never substitutes for a live visit.
    """
    initial, changes = timeline
    now = now or timezone.now()

    def aware(value):
        return timezone.make_aware(value, utc.utc) if timezone.is_naive(value) else value

    result = []
    for original in rows:
        row = dict(original)
        if str(row.get('live_session_status') or '').strip().lower() in INVALID:
            row['session_status'] = row['live_session_status']
        if any(original.get(key) in {'recorded', 'awaiting_recording'}
               for key in ('attendance_basis', 'final_outcome', 'effective_attendance_status')):
            for key in ('effective_attendance', 'effective_attendance_status', 'final_outcome'):
                row.pop(key, None)
            row['attendance_status'] = (original.get('raw_attendance_status')
                                        or original.get('teams_attendance_status') or 'unmarked')
        due = row.get('scheduled_end') or row.get('scheduled_start')
        if due:
            due = aware(due)
        elif row.get('session_date'):
            due = timezone.make_aware(datetime.combine(
                row['session_date'], row.get('session_start_time') or time.min))
        mode = initial
        for at, changed_mode in changes:
            if due is None or aware(at) > due:
                break
            mode = changed_mode
        if mode == 'lazy' and attendance_outcome(row, now)[0] != 'present':
            row['effective_attendance_status'] = 'unmarked'
        result.append(row)
    return result
