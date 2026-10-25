"""Explicit background import. No HTTP view invokes this module's writes."""
from urllib.parse import quote, urlencode


from curriculum_api.recordings_calendar_policy import meeting_key
from curriculum_api.recordings_external_policy import event_join_url, occurrence_recordings
from curriculum_api.session_graph import collection
from .recordings_calendar import _instant
from .recordings_calendar_media import attendance_rows, calendar_record, event_context
from .recordings_media import in_session_window
from .recordings_cache import recent_read


class CalendarMeetingWithoutTeams(ValueError):
    """A calendar appointment without a Teams recording/attendance source."""


def graph_target(context, event):
    from .views import get_graph_settings, microsoft_graph_request
    from curriculum_api.views import teams_online_meeting_owner_id
    if not event_join_url(event):
        event = microsoft_graph_request('GET', f'users/{quote(context["owner"], safe="")}/events/{quote(context["event"], safe="")}'
            '?$select=id,start,end,organizer,onlineMeeting,onlineMeetingUrl,body,isCancelled',
            extra_headers={'Prefer': 'outlook.timezone="UTC"'})
        if event_context(context['owner'], event) != context or event.get('isCancelled'):
            raise ValueError('Calendar occurrence changed during discovery.')
    link = event_join_url(event)
    organizer = str(((event.get('organizer') or {}).get('emailAddress') or {}).get('address') or '').strip().casefold()
    if not link:
        raise CalendarMeetingWithoutTeams('This calendar appointment has no Teams evidence source.')
    if not organizer:
        raise ValueError('This calendar entry has no accessible Teams identity.')
    def resolve():
        owner = recent_read('organizer', [get_graph_settings(), organizer, meeting_key(link)],
            lambda: teams_online_meeting_owner_id(organizer, link), timeout=600)
        query = urlencode({'$filter': "joinWebUrl eq '" + link.replace("'", "''") + "'", '$select': 'id,joinWebUrl'})
        matches = collection(microsoft_graph_request, f'users/{quote(owner, safe="")}/onlineMeetings?{query}', get_graph_settings()['base_url'])
        matches = {row['id']: row for row in matches if row.get('id') and meeting_key(row.get('joinWebUrl')) == meeting_key(link)}
        if len(matches) != 1:
            raise ValueError('Microsoft did not provide one verified Teams identity.')
        return f'users/{quote(owner, safe="")}/onlineMeetings/{quote(next(iter(matches)), safe="")}'
    return recent_read('meeting-target', [get_graph_settings(), organizer, meeting_key(link)], resolve, timeout=600), organizer


def fetch_recordings(context, event):
    """Small recording discovery; attendance never delays a ready recording."""
    from .views import get_graph_settings, microsoft_graph_request, serialize_coach_meeting_artifact
    base, organizer = graph_target(context, event)
    graph_base = get_graph_settings()['base_url']
    window = (_instant(context['start']), _instant(context['end']))
    files = recent_read('meeting-recordings', [get_graph_settings(), base],
        lambda: collection(microsoft_graph_request, f'{base}/recordings', graph_base), timeout=300)
    return base, organizer, [serialize_coach_meeting_artifact('recording', row) for row in occurrence_recordings(files, *window)]


def fetch_attendance(context, base):
    from .views import get_graph_settings, microsoft_graph_request, serialize_coach_meeting_attendance_report
    graph_base = get_graph_settings()['base_url']
    window = (_instant(context['start']), _instant(context['end']))
    reports = []
    sources = recent_read('meeting-reports', [get_graph_settings(), base],
        lambda: collection(microsoft_graph_request, f'{base}/attendanceReports', graph_base), timeout=300)
    for source in sources:
        belongs = in_session_window(source.get('meetingStartDateTime'), source.get('meetingEndDateTime'), window)
        if belongs is False:
            continue
        if not source.get('id'):
            raise ValueError('Incomplete attendance report identity.')
        path = f'{base}/attendanceReports/{quote(source["id"], safe="")}?$expand=attendanceRecords'
        detail = microsoft_graph_request('GET', path)
        if not isinstance(detail, dict) or detail.get('id') != source['id']:
            raise ValueError('Microsoft returned a different attendance report identity.')
        detail = {**detail, 'attendanceRecords': collection(microsoft_graph_request, path, graph_base, first=detail, key='attendanceRecords')}
        report = serialize_coach_meeting_attendance_report(source, detail)
        # Reports contain actual participants, without an expected learner roster.
        # A zero duration is pending evidence and cannot establish absence.
        report['absentCount'] = 0
        belongs = in_session_window(report['meetingStartDateTime'], report['meetingEndDateTime'], window)
        if belongs is None:
            raise ValueError('Attendance report dates could not be verified.')
        if belongs:
            reports.append(report)
    return reports


def fetch_snapshot(context, event):
    """Explicit backfill retains the complete recording/attendance contract."""
    base, organizer, artifacts = fetch_recordings(context, event)
    return base, organizer, artifacts, fetch_attendance(context, base)


def archive_calendar_recording(base, event_key, artifact_id):
    """Reject old callers explicitly; coach calendar recordings stay in Microsoft."""
    raise ValueError('Coach calendar recordings use SharePoint only; Azure copying is disabled.')


def sync_calendar_event(owner, event, *, archive=False, owner_name=''):
    if archive:
        raise ValueError('Coach calendar recordings use SharePoint only; Azure copying is disabled.')
    from .views import persist_coach_meeting_snapshots
    context = event_context(owner, event)
    base, organizer, artifacts, reports = fetch_snapshot(context, event)
    record = calendar_record(context, organizer=organizer, owner_name=owner_name)
    people = attendance_rows(reports)
    tracker = {'tracker': [{**row, 'id': row['email'] or f'actual:{index}', 'attended': row['status'] == 'attended'}
                           for index, row in enumerate(people)]}
    stored = persist_coach_meeting_snapshots(record, artifacts=artifacts, attendance_reports=reports, attendance_tracker=tracker)
    if not stored.get('stored'):
        raise RuntimeError('The calendar evidence snapshot could not be saved.')
    counts = {'recordings': len(artifacts), 'reports': len(reports), 'archived': 0, 'existing': 0}
    return counts
