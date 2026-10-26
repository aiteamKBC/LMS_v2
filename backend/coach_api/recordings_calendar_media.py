"""Occurrence identities and saved evidence for any authorised coach calendar event."""
from hashlib import sha256
import json
from types import SimpleNamespace

from django.core import signing
from django.db import connections, router

from curriculum_api.session_results_policy import evidence_seconds
from .models import CoachCalendarEvent
from .recordings_calendar import _email, _event_instant, _instant
from .recordings_media import in_session_window

SALT = 'coaching-calendar-evidence-v1'


def calendar_context(owner, event_id, start, end):
    owner, event_id = _email(owner), str(event_id or '')
    start, end = _instant(start), _instant(end)
    if not owner or '@' not in owner or not event_id or len(event_id) > 2048 or not start or not end or end <= start:
        raise ValueError('Invalid calendar occurrence.')
    return {'owner': owner, 'event': event_id, 'start': start.isoformat(), 'end': end.isoformat()}


def event_context(owner, event):
    return calendar_context(owner, event.get('id'), _event_instant(event.get('start')), _event_instant(event.get('end')))


def calendar_key(context):
    normal = calendar_context(context['owner'], context['event'], context['start'], context['end'])
    return 'coach-calendar:' + sha256(json.dumps(normal, sort_keys=True).encode()).hexdigest()


def calendar_reference(context):
    return signing.dumps(context, salt=SALT, compress=True)


def read_reference(token):
    value = signing.loads(token, salt=SALT, max_age=3600)
    return calendar_context(value['owner'], value['event'], value['start'], value['end'])


def calendar_record(context, *, organizer='', owner_name=''):
    """Adapter for the existing nullable-FK snapshot store; never a learner booking."""
    return SimpleNamespace(id=None, event_key=calendar_key(context), owner_email=context['owner'],
        owner_name=owner_name, graph_event_id=context['event'], graph_organizer_email=organizer,
        event_type='coach-calendar', learner_id=None, learner_name='', learner_email='',
        calendar_window=(_instant(context['start']), _instant(context['end'])))


def attendance_rows(reports):
    """Actual reported people only; union visits rather than summing overlapping devices."""
    groups, seen = {}, set()
    for report in reports:
        for index, row in enumerate(report.get('records') or []):
            if not isinstance(row, dict):
                raise ValueError('Invalid saved attendance record.')
            identity = (report['id'], row.get('id') or f'row:{index}')
            if identity in seen:
                continue
            seen.add(identity)
            email = _email(row.get('email'))
            key = f'email:{email}' if email else f'graph:{row["id"]}' if row.get('id') else f'anonymous:{report["id"]}:{index}'
            person = groups.setdefault(key, {'name': row.get('displayName') or email or 'Unidentified participant',
                'email': email, 'role': row.get('role') or 'attendee', 'expected': False, '_records': []})
            person['_records'].append({**row, 'total_attendance_seconds': row.get('totalAttendanceSeconds') or 0})
    result = []
    for person in groups.values():
        seconds = evidence_seconds(person.pop('_records'))
        result.append({**person, 'totalAttendanceSeconds': seconds, 'status': 'attended' if seconds > 0 else 'pending'})
    return result


def saved_calendar_attendance(record):
    database = router.db_for_read(CoachCalendarEvent) or 'default'
    with connections[database].cursor() as cursor:
        cursor.execute('''SELECT graph_report_id,meeting_start_datetime,meeting_end_datetime,metadata,last_seen_at
            FROM "Coach".coach_meeting_attendance_reports
            WHERE owner_email=%s AND graph_event_id=%s
            AND (event_key=%s OR (meeting_start_datetime<%s AND meeting_end_datetime>%s))
            ORDER BY meeting_start_datetime,graph_report_id''',
            [record.owner_email, record.graph_event_id, record.event_key, record.calendar_window[1], record.calendar_window[0]])
        rows = cursor.fetchall()
    reports, stamps, uncertain = [], [], False
    for report_id, start, end, metadata, stamp in rows:
        belongs = in_session_window(start, end, record.calendar_window)
        if belongs is False:
            continue
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        if not belongs or not isinstance(metadata, dict) or metadata.get('id') != report_id or not isinstance(metadata.get('records'), list):
            uncertain = True
            continue
        reports.append(metadata)
        if _instant(stamp):
            stamps.append(_instant(stamp))
    return {'state': 'unavailable' if uncertain else 'available' if reports else 'pending',
            'reportCount': len(reports), 'rows': [] if uncertain else attendance_rows(reports),
            'syncedAt': max(stamps).isoformat() if stamps else None}
