"""On-demand, read-only access to the existing Coaching Session evidence source.

Never match by learner name, title or date alone. No Microsoft or AI calls.
"""
from datetime import timedelta
import json
import logging
import os
import re
import sys
from urllib.parse import unquote

from django.conf import settings

from .recordings_cache import recent_read
from .recordings_calendar import _email, _instant
from .recordings_calendar_media import attendance_rows
from .recordings_media import in_session_window, session_window

log = logging.getLogger(__name__)


def source_dsn():
    if ('test' in sys.argv or getattr(settings, 'COACH_TEST_MODE', False)
            or getattr(settings, 'RUN_APP_ON_TEST_BRANCH', False)
            or getattr(settings, 'USE_SECURITY_TEST_BRANCH', False)):
        return ''
    value = os.environ.get('COACHING_SESSIONS_DATABASE_URL', '').strip()
    if value.lower().startswith('psql '):
        value = value[5:].strip()
    return value.strip('"').strip("'").strip()


def empty_evidence(state):
    return {'state': state, 'source': 'coaching-session', 'transcript': None, 'analyses': [],
            'attendance': {'state': 'pending', 'reportCount': 0, 'rows': []}}


def online_identity(job):
    # This base was resolved and verified by the recording worker, never the client.
    base = (job.result or {}).get('base', '') if job else ''
    match = re.fullmatch(r'/?users/[^/]+/onlineMeetings/([^/?]+)', base)
    return unquote(match[1]) if match else ''


def same_occurrence(row, owner, event, online, window):
    begin = _instant(row.get('start_at'))
    return (_email(row.get('coach_email')) == owner
            and (row.get('event_id') == event or bool(online and row.get('online_meeting_id') == online))
            and begin is not None and abs(begin - window[0]) <= timedelta(minutes=15)
            and in_session_window(begin, row.get('end_at'), window) is True)


def _attendance(cursor, meeting_id, window):
    cursor.execute('''SELECT id,report_id,status,meeting_start_at,meeting_end_at,updated_at
        FROM public.attendance_reports WHERE meeting_id=%s
        ORDER BY updated_at DESC LIMIT 51''', [meeting_id])
    reports = cursor.fetchall()
    if len(reports) > 50:
        raise ValueError('Too many occurrence reports.')
    reports = [row for row in reports if row['status'] == 'synced'
               and in_session_window(row['meeting_start_at'], row['meeting_end_at'], window) is True]
    if not reports:
        return {'state': 'pending', 'reportCount': 0, 'rows': []}
    cursor.execute('''SELECT report_id,graph_record_id,email,display_name,role,
        total_attendance_seconds,intervals FROM public.attendance_records
        WHERE report_id=ANY(%s) ORDER BY report_id,id LIMIT 501''', [[row['id'] for row in reports]])
    participants = cursor.fetchall()
    if len(participants) > 500:
        raise ValueError('Too many occurrence participants.')
    actual = [{'id': str(report['id']), 'records': [
        {'id': str(row['graph_record_id'] or index), 'email': row['email'],
         'displayName': row['display_name'], 'role': row['role'],
         'totalAttendanceSeconds': row['total_attendance_seconds'], 'intervals': row['intervals'] or []}
        for index, row in enumerate(participants) if row['report_id'] == report['id']]}
        for report in reports]
    return {'state': 'available', 'reportCount': len(reports),
        'rows': attendance_rows(actual), 'source': 'coaching-session',
        'syncedAt': max(row['updated_at'] for row in reports).isoformat()}


def _dashboard_evidence(cursor, meeting_id, window, learner_ids, *, include_context=False, owner=None):
    """Read the same rows and stable session IDs used by Coaching Session.

    This runs only after the Microsoft meeting/owner/occurrence was verified.
    Names, subjects and planned dates never establish an evidence association.
    """
    context = ''
    if include_context:
        fields = ('learner_name', 'learner_email', 'case_owner', 'manager_name', 'manager_email',
                  'program_name', 'learner_status', 'component_name', 'source', 'planned_date',
                  'aptem_status', 'meeting_id', 'meeting_subject', 'meeting_start_time',
                  'days_from_planned', 'learner_attended', 'manager_attended', 'has_transcript', 'tab')
        context = ',jsonb_build_object(' + ','.join(f"'{field}',to_jsonb(d)->'{field}'" for field in fields) + ') AS report_context'
    owner_clause = ' AND lower(trim(case_owner_email))=%s' if owner else ''
    multiple = isinstance(meeting_id, (list, tuple))
    meeting_clause = 'meeting_id=ANY(%s)' if multiple else 'meeting_id=%s'
    cursor.execute('''SELECT 'dashboard:' || id::text AS id,
        md5(concat_ws('|',coalesce(learner_email,''),coalesce(source,''),
            coalesce(component_name,''),coalesce(planned_date::text,''),
            coalesce(meeting_id::text,''),coalesce(meeting_start_time::text,''))) AS source_session_id,
        learner_id,learner_name,source AS component_type,ai_status,
        report_ai AS report,ai_checked_at,has_transcript,transcript,updated_at''' + context + '''
        FROM public.dashboard_sessions_cache d
        WHERE ''' + meeting_clause + ''' AND meeting_start_time BETWEEN %s AND %s
        AND (%s OR learner_id=ANY(%s))''' + owner_clause + ''' ORDER BY id LIMIT 101''',
        [[str(value) for value in meeting_id] if multiple else str(meeting_id), window[0] - timedelta(minutes=15), window[0] + timedelta(minutes=15),
         learner_ids is None, learner_ids or [], *([owner] if owner else [])])
    rows = cursor.fetchall()
    if len(rows) > 100:
        raise ValueError('Evidence exceeds the bounded meeting scope.')
    if include_context:
        for row in rows:
            value = row.get('report_context') or {}
            if isinstance(value, str):
                value = json.loads(value)
            if not isinstance(value, dict):
                raise ValueError('Saved report context is invalid.')
            row['report_context'] = value
    return rows


def _analyses(rows, part):
    return [{'id': str(row['id']), 'learnerName': row['learner_name'] or '',
        'type': row['component_type'] or '', 'status': row['ai_status'] or 'not-analysed',
        'report': row['report'] if row['ai_status'] == 'completed' else None,
        'sourceSessionId': row.get('source_session_id'),
        'updatedAt': row['ai_checked_at'].isoformat() if row['ai_checked_at'] else None,
        **({'session': row.get('report_context') or {}} if part == 'pdf' else {})}
        for row in rows]


def _dashboard_transcript(rows):
    parts = list(dict.fromkeys(row['transcript'] for row in rows
        if row.get('has_transcript') and row.get('transcript')))
    stamps = [row['updated_at'] for row in rows if row.get('updated_at')]
    return {'content': '\n\n'.join(parts), 'durationSeconds': None,
        'updatedAt': max(stamps).isoformat() if stamps else None} if parts else None


def _meeting_transcript(cursor, meeting_ids):
    # IDs have already been verified as copies of one physical occurrence.
    # The same Graph transcript can be ingested under several calendar copies.
    cursor.execute('''SELECT content,duration_seconds,status,updated_at FROM (
        SELECT DISTINCT ON (transcript_id) transcript_id,content,duration_seconds,status,updated_at,created_at
        FROM public.meeting_transcripts WHERE meeting_id=ANY(%s::uuid[])
        ORDER BY transcript_id,updated_at DESC,id DESC
        ) latest ORDER BY created_at,transcript_id LIMIT 21''', [list(meeting_ids)])
    transcripts = cursor.fetchall()
    if len(transcripts) > 20:
        raise ValueError('Too many transcript parts.')
    parts = {}
    for row in transcripts:
        if row['status'] == 'synced' and row['content']:
            parts.setdefault(row['content'], row)
    transcripts = list(parts.values())
    if not transcripts:
        return None
    stamps = [row['updated_at'] for row in transcripts if row['updated_at']]
    return {
        'content': transcripts[0]['content'] if len(transcripts) == 1 else '\n\n'.join(
            f'Transcript {index + 1}\n{row["content"]}' for index, row in enumerate(transcripts)),
        # Parts can overlap; do not invent a summed meeting duration.
        'durationSeconds': transcripts[0]['duration_seconds'] if len(transcripts) == 1 else None,
        'updatedAt': max(stamps).isoformat() if stamps else None}


def _shared_dashboard(cursor, owner, online, window, learner_ids, part):
    """A calendar attendee can own the review while another account hosts Teams.

    Only a worker-verified online identity may cross the source organizer account.
    The original report must still belong to this coach and current learner scope.
    Transcripts belong to the verified physical meeting, including Other types.
    Do not broaden AI report ownership, attendance or name/title matching.
    """
    cursor.execute('''SELECT id,online_meeting_id,start_at,end_at FROM public.meetings
        WHERE online_meeting_id=%s AND start_at BETWEEN %s AND %s
        AND end_at>%s AND start_at<%s LIMIT 51''',
        [online, window[0] - timedelta(minutes=15), window[0] + timedelta(minutes=15), window[0], window[1]])
    candidates = cursor.fetchall()
    if len(candidates) > 50:
        raise ValueError('Shared occurrence exceeds the bounded source scope.')
    matches = [row for row in candidates if row['online_meeting_id'] == online
        and (begin := _instant(row['start_at'])) is not None
        and abs(begin - window[0]) <= timedelta(minutes=15)
        and in_session_window(begin, row['end_at'], window) is True]
    exact = [row for row in matches if _instant(row['start_at']) == window[0]]
    matches = exact or matches
    if not matches or len({_instant(row['start_at']) for row in matches}) != 1:
        return empty_evidence('ambiguous' if matches else 'not-found')
    # Several normalized rows can be calendar copies of this same physical
    # online occurrence. Read their original coach-owned reports in one query.
    meeting_ids = list(dict.fromkeys(row['id'] for row in matches))
    rows = _dashboard_evidence(cursor, meeting_ids, window, learner_ids,
        include_context=part == 'pdf', owner=owner)
    transcript = _dashboard_transcript(rows) or _meeting_transcript(cursor, meeting_ids)
    if not rows and not transcript:
        return empty_evidence('not-found')
    return {**empty_evidence('matched'), 'transcript': transcript,
        'analyses': _analyses(rows, part)}


def _read(dsn, owner, event, online, window, learner_ids, *, part='all'):
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=3,
                         options='-c default_transaction_read_only=on') as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '2500ms'")
            # The source application uses UTC for its md5 session identity.
            cursor.execute("SET LOCAL TIME ZONE 'UTC'")
            cursor.execute('''SELECT id,coach_email,event_id,online_meeting_id,start_at,end_at
                FROM public.meetings WHERE lower(trim(coach_email))=%s
                AND (event_id=%s OR (%s<>'' AND online_meeting_id=%s))
                AND start_at BETWEEN %s AND %s AND end_at>%s AND start_at<%s LIMIT 3''',
                [owner, event, online, online, window[0] - timedelta(minutes=15),
                 window[0] + timedelta(minutes=15), window[0], window[1]])
            candidates = [row for row in cursor.fetchall() if same_occurrence(row, owner, event, online, window)]
            exact = [row for row in candidates if row['event_id'] == event]
            matches = exact or candidates
            if len(matches) != 1:
                if not matches and online and part != 'attendance':
                    return _shared_dashboard(cursor, owner, online, window, learner_ids, part)
                return empty_evidence('ambiguous' if matches else 'not-found')
            meeting_id = matches[0]['id']
            result = empty_evidence('matched')
            if part == 'attendance':
                result['attendance'] = _attendance(cursor, meeting_id, window)
                return result
            dashboard = _dashboard_evidence(cursor, meeting_id, window, learner_ids, include_context=part == 'pdf')
            result['transcript'] = _dashboard_transcript(dashboard)
            if not result['transcript']:
                result['transcript'] = _meeting_transcript(cursor, [meeting_id])
            if dashboard:
                analyses = dashboard
            else:
                cursor.execute('''SELECT c.id,c.learner_id,c.learner_name,c.component_type,
                    r.ai_status,r.report,r.ai_checked_at
                    FROM public.all_sessions_cache c LEFT JOIN public.report_ai r ON r.session_id=c.id
                    WHERE c.meeting_id=%s AND lower(trim(c.coach_email))=%s
                    AND (%s OR c.learner_id=ANY(%s)) ORDER BY c.id LIMIT 101''',
                    [meeting_id, owner, learner_ids is None, learner_ids or []])
                analyses = cursor.fetchall()
            if len(analyses) > 100:
                raise ValueError('Evidence exceeds the bounded meeting scope.')
            result['analyses'] = _analyses(analyses, part)
            if (not result['analyses'] or not result['transcript']) and online and part in ('evidence', 'pdf'):
                shared = _shared_dashboard(cursor, owner, online, window, learner_ids, part)
                if shared['state'] == 'matched':
                    result['analyses'] = result['analyses'] or shared['analyses']
                    result['transcript'] = result['transcript'] or shared['transcript']
            if part not in ('evidence', 'pdf'):
                result['attendance'] = _attendance(cursor, meeting_id, window)
            return result


def saved_evidence(record, job, *, learner_ids=None, part='all'):
    dsn, window = source_dsn(), session_window(record)
    if not dsn:
        return empty_evidence('unavailable')
    if not all(window) or not record.graph_event_id:
        return empty_evidence('not-found')
    owner, online = _email(record.owner_email), online_identity(job)
    identity = ['dashboard-source-v5', dsn, owner, record.graph_event_id, online, window, learner_ids, part]
    try:
        # Source identity and current learner scope are part of the private key.
        # A brief failure cooldown prevents attendance polls hammering an offline DB.
        def guarded_read():
            try:
                return _read(dsn, owner, record.graph_event_id, online, window, learner_ids, part=part)
            except Exception as failure:
                log.warning('Saved coaching evidence unavailable (%s).', type(failure).__name__)
                return empty_evidence('unavailable')
        return recent_read('saved-evidence', identity,
            lambda: recent_read('saved-evidence-attempt', identity, guarded_read, timeout=15),
            cache_if=lambda value: value['state'] != 'unavailable', timeout=60)
    except Exception as failure:
        # Exception strings may contain SQL, credentials or transcript content.
        log.warning('Saved coaching evidence unavailable (%s).', type(failure).__name__)
        return empty_evidence('unavailable')
