"""Every saved live-session recording, filed by module delivery and week.

One page for whoever looks after recordings: narrow by programme, cohort,
group, module and week, and play or download what Teams recorded there. Each
entry is one delivery (a module record is one group's delivery) carrying its
programme, cohort and group, so the page can show everything under any level.
Read only. Nothing here calls Graph, lists Azure, starts a sync or touches a
meeting; playback and download go through the existing staff file route
(``session_results.admin_content``). Every status below comes from rows a sync
already persisted, so loading the page never costs a Microsoft or storage call.

A recording belongs to the week whose live-session component owns its
occurrence. That pairing is the one ``attach_teams_meeting_to_module_weeks``
writes onto the component (``teamsOccurrenceId``, else series + session
number), and an additional week meeting is found by its own
``extraTeamsLiveSessionId``. Session numbers are never counted against weeks:
a gap or a cancellation would slide every later recording onto the wrong week.
A recording no component claims is still listed, under "Not matched to a week",
rather than dropped.

A deleted (archived) module keeps its recordings. They are listed, flagged
``archived``, under the weeks that were deleted together with the module; the
page shows them only when asked and never counts them with running modules.

Graph can list one recording under two ids (same call, same content
correlation id, same start and end; the saved files are byte-identical). Such
copies are shown once, with ``duplicateCount`` saying how many more are stored.
"""
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_role

from .session_media_policy import artifact_metadata
from .session_component_identity import TIMEZONE_ALIASES
from .session_results import read, unavailable
from .session_results_policy import instant

MODULES_SQL = '''SELECT m.module_catalogue_id, m.title, m.programme_name, m.cohort_name,
        m.group_name, m.deleted_at, m.is_programme_deleted, p.status AS programme_status
    FROM curriculum.modules m
    LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
    ORDER BY m.programme_name, m.cohort_name, m.group_name, m.title, m.module_catalogue_id'''

# Same series filter as the module Sessions tab, so both list the same recordings.
RECORDINGS_SQL = '''SELECT a.id AS artifact_id, a.created_datetime, a.end_datetime, a.metadata,
        a.call_id, a.content_correlation_id,
        o.id AS occurrence_id, o.live_session_id AS series_id, o.session_number, o.scheduled_start,
        s.timezone AS series_timezone,
        m.module_catalogue_id, m.title AS module_title, m.programme_name, m.cohort_name, m.group_name,
        (m.deleted_at IS NOT NULL OR COALESCE(m.is_programme_deleted, false)) AS module_archived,
        p.status AS programme_status, r.status AS archive_status
    FROM curriculum.live_session_artifacts a
    JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
    JOIN curriculum.live_sessions s ON s.id=o.live_session_id
    JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
    LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
    LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id
    WHERE a.artifact_type='recording' AND s.status NOT IN ('deleted','superseded','failed')
    ORDER BY o.scheduled_start, a.created_datetime, a.id'''

# A running module's live weeks; an archived module's weeks as they stood when
# it was deleted (deleting a module soft-deletes its weeks in the same moment).
_KEPT_WITH_MODULE = '''(
        (x.deleted_at IS NULL AND NOT COALESCE(x.is_programme_deleted, false))
        OR (m.deleted_at IS NOT NULL AND x.deleted_at >= m.deleted_at - interval '5 minutes')
        OR (COALESCE(m.is_programme_deleted, false) AND x.deleted_at IS NULL))'''

WEEKS_SQL = '''SELECT x.id, x.module_catalogue_id, x.week_number, x.title, x.display_order
    FROM curriculum.weeks x JOIN curriculum.modules m ON m.module_catalogue_id=x.module_catalogue_id
    WHERE x.module_catalogue_id=ANY(%s) AND COALESCE(x.library_state, '')<>'library' AND ''' + _KEPT_WITH_MODULE + '''
    ORDER BY x.display_order, x.week_number, x.id'''

# Only transfer settings consumed by this read-only library. Full component settings
# contain meeting payloads that are large and never used here. Keep non-object
# legacy JSON unchanged so _settings retains its existing decoding semantics.
LIVE_COMPONENTS_SQL = '''SELECT x.week_id, x.module_catalogue_id, CASE WHEN jsonb_typeof(x.settings_json)='object' THEN jsonb_build_object(
            'teamsOccurrenceId', x.settings_json -> 'teamsOccurrenceId',
            'teamsLiveSessionId', x.settings_json -> 'teamsLiveSessionId',
            'teamsSessionNumber', x.settings_json -> 'teamsSessionNumber',
            'extraTeamsLiveSessionId', x.settings_json -> 'extraTeamsLiveSessionId',
            'recordingSeriesId', x.settings_json -> 'recordingSeriesId',
            'recordingDate', x.settings_json -> 'recordingDate'
        ) ELSE x.settings_json END AS settings_json
    FROM curriculum.components x JOIN curriculum.modules m ON m.module_catalogue_id=x.module_catalogue_id
    WHERE x.module_catalogue_id=ANY(%s) AND COALESCE(x.library_state, '')<>'library'
    AND (x.type IN ('live-session','live_session') OR x.settings_json->>'recordingSeriesId' IS NOT NULL)
    AND ''' + _KEPT_WITH_MODULE + '''
    ORDER BY x.display_order, x.id'''

# Every live session of every running module, for the sessions that need attention.
ATTENTION_COMPONENTS_SQL = '''SELECT c.id AS component_id, c.title AS component_title,
        c.week_id, c.module_catalogue_id, CASE WHEN jsonb_typeof(c.settings_json)='object' THEN jsonb_build_object(
            'teamsOccurrenceId', c.settings_json -> 'teamsOccurrenceId',
            'teamsLiveSessionId', c.settings_json -> 'teamsLiveSessionId',
            'teamsSessionNumber', c.settings_json -> 'teamsSessionNumber',
            'extraTeamsLiveSessionId', c.settings_json -> 'extraTeamsLiveSessionId'
        ) ELSE c.settings_json END AS settings_json,
        w.week_number, w.title AS week_title, w.display_order,
        m.title AS module_title, m.programme_name, m.cohort_name, m.group_name, p.status AS programme_status
    FROM curriculum.components c
    JOIN curriculum.weeks w ON w.id=c.week_id
    JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
    LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
    WHERE c.type IN ('live-session','live_session') AND c.deleted_at IS NULL
    AND NOT COALESCE(c.is_programme_deleted, false) AND COALESCE(c.library_state, '')<>'library'
    AND w.deleted_at IS NULL AND NOT COALESCE(w.is_programme_deleted, false)
    AND m.deleted_at IS NULL AND NOT COALESCE(m.is_programme_deleted, false)
    ORDER BY w.display_order, w.week_number, c.display_order, c.id'''

# Author labels also remain useful for archived deliveries. Keep only weeks
# deleted with their parent module; a separately removed component is not a link.
CALENDAR_COMPONENTS_SQL = '''SELECT c.id AS component_id, c.title AS component_title,
        c.week_id,
        c.module_catalogue_id, CASE WHEN jsonb_typeof(c.settings_json)='object' THEN jsonb_build_object(
            'teamsOccurrenceId', c.settings_json -> 'teamsOccurrenceId',
            'teamsLiveSessionId', c.settings_json -> 'teamsLiveSessionId',
            'teamsSessionNumber', c.settings_json -> 'teamsSessionNumber',
            'extraTeamsLiveSessionId', c.settings_json -> 'extraTeamsLiveSessionId',
            'sessionDateTimeUtc', c.settings_json -> 'sessionDateTimeUtc',
            'teamsStartDateTimeUtc', c.settings_json -> 'teamsStartDateTimeUtc',
            'sessionDate', c.settings_json -> 'sessionDate',
            'sessionTime', c.settings_json -> 'sessionTime',
            'sessionTimeZone', c.settings_json -> 'sessionTimeZone',
            'durationMinutes', c.settings_json -> 'durationMinutes',
            'teamsDurationMinutes', c.settings_json -> 'teamsDurationMinutes'
        ) ELSE c.settings_json END AS settings_json, w.week_number, w.title AS week_title,
        m.title AS module_title, m.programme_name, m.cohort_name, m.group_name,
        (m.deleted_at IS NOT NULL OR COALESCE(m.is_programme_deleted, false)) AS module_archived,
        p.status AS programme_status
    FROM curriculum.components c
    JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
    JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
    LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
    WHERE c.type IN ('live-session','live_session')
      AND COALESCE(c.library_state, '')<>'library'
      AND COALESCE(w.library_state, '')<>'library'
      AND ''' + _KEPT_WITH_MODULE.replace('x.', 'c.') + '''
      AND ''' + _KEPT_WITH_MODULE.replace('x.', 'w.') + '''
    ORDER BY c.id'''

# Scheduled sessions, with what the last results sync of their meeting reported.
OCCURRENCES_SQL = '''SELECT o.id, o.live_session_id, o.session_number, o.scheduled_start, o.scheduled_end,
        o.status, o.actual_start, s.status AS series_status, j.state AS job_state, j.finished_at AS job_finished_at,
        s.module_catalogue_id, s.module_title AS series_module_title, s.timezone AS series_timezone,
        COALESCE(NULLIF(o.join_url, ''), s.join_url) AS join_url,
        m.title AS module_title, m.programme_name, m.cohort_name, m.group_name,
        (m.deleted_at IS NOT NULL OR COALESCE(m.is_programme_deleted, false)) AS module_archived,
        p.status AS programme_status,
        EXISTS (SELECT 1 FROM curriculum.live_session_artifacts a
                WHERE a.occurrence_id=o.id AND a.artifact_type='recording') AS has_recording
    FROM curriculum.live_session_occurrences o
    JOIN curriculum.live_sessions s ON s.id=o.live_session_id
    LEFT JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
    LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
    LEFT JOIN curriculum.session_result_jobs j ON j.live_session_id=s.id
    WHERE o.scheduled_start IS NOT NULL AND s.status NOT IN ('deleted','superseded','failed')'''

# Teams can take a while to publish a recording after a meeting ends. A session
# is judged only after this, and only by a sync that finished after it.
RECORDING_PROCESSING = timedelta(hours=2)
DEFAULT_SESSION_LENGTH = timedelta(hours=2)
# A run this far from the scheduled start was not this session's delivery.
RUN_DATE_TOLERANCE = timedelta(hours=12)


def _settings(value):
    if isinstance(value, dict):
        return value
    try:
        decoded = json.loads(value or '')
    except (TypeError, ValueError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _text(value):
    return str(value or '').strip()


def week_owners(components):
    """Which week owns each occurrence, series session, and dated recording."""
    by_occurrence, by_session, by_extra_series, by_recording_day = {}, {}, {}, {}
    for row in components:
        settings, week_id = _settings(row.get('settings_json')), row.get('week_id')
        occurrence = _text(settings.get('teamsOccurrenceId'))
        series, number = _text(settings.get('teamsLiveSessionId')), _text(settings.get('teamsSessionNumber'))
        extra = _text(settings.get('extraTeamsLiveSessionId'))
        if occurrence:
            by_occurrence.setdefault(occurrence, week_id)
        if series and number:
            by_session.setdefault((series, number), week_id)
        if extra:
            by_extra_series.setdefault(extra, week_id)
        recording_series = _text(settings.get('recordingSeriesId'))
        recording_day = _text(settings.get('recordingDate'))
        if recording_series and recording_day:
            by_recording_day.setdefault((recording_series, recording_day), week_id)
        elif series and recording_day:
            by_recording_day.setdefault((series, recording_day), week_id)
    return by_occurrence, by_session, by_extra_series, by_recording_day


def recording_week(row, owners):
    by_occurrence, by_session, by_extra_series, by_recording_day = owners
    recorded = instant(row.get('created_datetime')) if row.get('created_datetime') else None
    day = recorded.astimezone(ZoneInfo('Europe/London')).date().isoformat() if recorded else ''
    return (by_recording_day.get((_text(row.get('series_id')), day))
            or by_occurrence.get(_text(row.get('occurrence_id')))
            or by_session.get((_text(row.get('series_id')), _text(row.get('session_number'))))
            or by_extra_series.get(_text(row.get('series_id'))))


def _iso(value):
    moment = instant(value) if value else None
    return moment.isoformat().replace('+00:00', 'Z') if moment else None


def _component_start(settings):
    """The authored instant; never invent a time from a date alone."""
    explicit = settings.get('sessionDateTimeUtc') or settings.get('teamsStartDateTimeUtc')
    if explicit:
        try:
            return instant(explicit)
        except (TypeError, ValueError):
            return None
    date, clock = _text(settings.get('sessionDate')), _text(settings.get('sessionTime'))
    if not date or not clock:
        return None
    try:
        zone = ZoneInfo(_text(settings.get('sessionTimeZone')) or 'Europe/London')
        return datetime.fromisoformat(f'{date}T{clock}').replace(tzinfo=zone).astimezone(timezone.utc)
    except (TypeError, ValueError, ZoneInfoNotFoundError):
        return None


def module_index(rows):
    """Every saved module delivery, including one without a booked lecture."""
    return [{
        'moduleId': row['module_catalogue_id'], 'title': _text(row.get('title')) or 'Untitled module',
        'programme': _text(row.get('programme_name')),
        'cohort': _text(row.get('cohort_name')), 'group': _text(row.get('group_name')),
        'archived': bool(row.get('deleted_at') or row.get('is_programme_deleted')),
        'programmeActive': programme_active(row.get('programme_status')),
    } for row in rows]


def programme_active(status):
    # Draft and archived programmes are not running; a module with no programme row counts as active.
    return _text(status).lower() not in ('draft', 'archived')


def recording_status(archive_status):
    """Where the saved copy stands, from the archive row alone."""
    state = _text(archive_status).lower()
    if state == 'ready':
        return 'available'
    if state == 'failed':
        return 'missingAzureFile'
    # Pending, or Teams listed it but no copy was ever started.
    return 'verificationRequired'


def same_recording_key(row):
    """Graph's two ids for one recording share call, correlation id and timing; anything else is its own."""
    correlation = _text(row.get('content_correlation_id'))
    if not correlation:
        return ('id', row['artifact_id'])
    return (_text(row.get('occurrence_id')), _text(row.get('call_id')), correlation,
            _text(row.get('created_datetime')), _text(row.get('end_datetime')))


def placement_review_ids(recordings, occurrences):
    """Flag historical media whose recorded day cannot confirm its saved week.

    Teams exposes one recording list for a recurring meeting. Older imports
    assigned rehearsals to the nearest planned occurrence. Keep those files and
    their database links intact, but do not present them as confirmed lectures.
    """
    local_days = {}
    for occurrence in occurrences:
        start = instant(occurrence.get('scheduled_start')) if occurrence.get('scheduled_start') else None
        if not start:
            continue
        zone_name = _text(occurrence.get('series_timezone')) or 'Europe/London'
        zone_name = TIMEZONE_ALIASES.get(zone_name, zone_name)
        try:
            day = start.astimezone(ZoneInfo(zone_name)).date().isoformat()
        except ZoneInfoNotFoundError:
            continue
        key = (_text(occurrence.get('live_session_id')), _text(occurrence.get('module_catalogue_id')), day)
        local_days.setdefault(key, set()).add(_text(occurrence.get('id')))

    review = set()
    for recording in recordings:
        recorded = instant(recording.get('created_datetime')) if recording.get('created_datetime') else None
        scheduled = instant(recording.get('scheduled_start')) if recording.get('scheduled_start') else None
        if not recorded or not scheduled:
            continue
        zone_name = _text(recording.get('series_timezone')) or 'Europe/London'
        zone_name = TIMEZONE_ALIASES.get(zone_name, zone_name)
        try:
            day = recorded.astimezone(ZoneInfo(zone_name)).date().isoformat()
        except ZoneInfoNotFoundError:
            continue
        key = (_text(recording.get('series_id')), _text(recording.get('module_catalogue_id')), day)
        matches = local_days.get(key, set())
        if ((len(matches) == 1 and _text(recording.get('occurrence_id')) not in matches)
                or (len(matches) != 1 and abs(recorded - scheduled) > RUN_DATE_TOLERANCE)):
            review.add(recording['artifact_id'])
    return review


def session_attention(occurrence, now):
    """(status, reason) for a past session with no recording, or None when nothing needs checking.

    A session marked completed is never enough on its own: a recording is
    called missing only after a complete sync that finished once Teams had
    time to publish it. Anything less is a sync problem, not a missing file.
    """
    if occurrence.get('has_recording'):
        return None
    if _text(occurrence.get('status')).lower() == 'cancelled' or _text(occurrence.get('series_status')).lower() == 'cancelled':
        return None
    start = instant(occurrence.get('scheduled_start')) if occurrence.get('scheduled_start') else None
    end = instant(occurrence.get('scheduled_end')) if occurrence.get('scheduled_end') else None
    end = end or (start + DEFAULT_SESSION_LENGTH if start else None)
    if not end or end + RECORDING_PROCESSING > now:
        return None  # not over, or Teams may still be preparing the recording
    ran = _text(occurrence.get('status')).lower() == 'completed'
    actual = instant(occurrence.get('actual_start')) if occurrence.get('actual_start') else None
    misdated = ''
    if ran and actual and start and abs(actual - start) > RUN_DATE_TOLERANCE:
        misdated = (f' Teams activity was stored for {actual:%d %b %Y}, not the scheduled date, '
                    'so check which meeting this session took place in.')
    job_state = _text(occurrence.get('job_state')).lower()
    finished = instant(occurrence.get('job_finished_at')) if occurrence.get('job_finished_at') else None
    if job_state == 'failed':
        return 'missingSync', 'The last results synchronization for this meeting did not complete, so a recording may not have been collected.' + misdated
    if job_state != 'complete' or not finished or finished < end + RECORDING_PROCESSING:
        return 'missingSync', 'Results have not been synchronized since this session ended.' + misdated
    if not ran:
        return None  # a complete sync found no run in Teams: nothing was there to record
    if misdated:
        return 'verificationRequired', misdated.strip()
    return 'notRecorded', 'A complete synchronization after this session found no recording in Teams.'


def attention_by_module(components, occurrences, now):
    """Sessions that need checking, per running module, from persisted sync results only."""
    by_id = {row['id']: row for row in occurrences}
    by_session = {(_text(row.get('live_session_id')), _text(row.get('session_number'))): row for row in occurrences}
    recorded_series = {_text(row.get('live_session_id')) for row in occurrences if row.get('has_recording')}
    modules = {}
    for row in components:
        settings = _settings(row.get('settings_json'))
        occurrence = by_id.get(_text(settings.get('teamsOccurrenceId'))) or by_session.get(
            (_text(settings.get('teamsLiveSessionId')), _text(settings.get('teamsSessionNumber'))))
        if not occurrence or _text(settings.get('extraTeamsLiveSessionId')) in recorded_series - {''}:
            continue
        verdict = session_attention(occurrence, now)
        if not verdict:
            continue
        module = modules.setdefault(row['module_catalogue_id'], {'row': row, 'sessions': [], 'seen': set()})
        if occurrence['id'] in module['seen']:
            continue
        module['seen'].add(occurrence['id'])
        module['sessions'].append({
            'occurrenceId': occurrence['id'], 'weekId': row.get('week_id'), 'weekNumber': row.get('week_number'),
            'weekTitle': _text(row.get('week_title')), 'sessionNumber': occurrence.get('session_number'),
            'startsAt': _iso(occurrence.get('scheduled_start')), 'status': verdict[0], 'reason': verdict[1]})
    return modules


def calendar_sessions(components, occurrences, now=None):
    """List every persisted LMS Teams occurrence, enriching it with its week when linked.

    The occurrence ID is authoritative. A missing curriculum component must
    never hide the meeting or turn its week number into a lecture title.
    """
    by_occurrence, by_session, by_extra_series, by_start = {}, {}, {}, {}
    for component in components:
        settings = _settings(component.get('settings_json'))
        module_id = _text(component.get('module_catalogue_id'))
        occurrence_id = _text(settings.get('teamsOccurrenceId'))
        series_id = _text(settings.get('teamsLiveSessionId'))
        session_number = _text(settings.get('teamsSessionNumber'))
        extra_series = _text(settings.get('extraTeamsLiveSessionId'))
        if occurrence_id:
            by_occurrence.setdefault((module_id, occurrence_id), component)
        if series_id and session_number:
            by_session.setdefault((module_id, series_id, session_number), component)
        if extra_series:
            by_extra_series.setdefault((module_id, extra_series), component)
        start = _component_start(settings)
        if start:
            by_start.setdefault((module_id, _iso(start)), []).append(component)

    sessions, matched = [], set()
    for occurrence in occurrences:
        module_id = _text(occurrence.get('module_catalogue_id'))
        series_id = _text(occurrence.get('live_session_id'))
        component = (by_occurrence.get((module_id, _text(occurrence.get('id'))))
                     or by_session.get((module_id, series_id, _text(occurrence.get('session_number'))))
                     or by_extra_series.get((module_id, series_id)) or {})
        if not component:
            candidates = by_start.get((module_id, _iso(occurrence.get('scheduled_start'))), [])
            if len(candidates) == 1:
                component = candidates[0]
        if component:
            matched.add(id(component))
        cancelled = (_text(occurrence.get('status')).lower() == 'cancelled'
                     or _text(occurrence.get('series_status')).lower() == 'cancelled')
        verdict = session_attention(occurrence, now) if now and not cancelled else None
        module_title = (_text(occurrence.get('module_title'))
                        or _text(occurrence.get('series_module_title'))
                        or _text(component.get('module_title')) or 'Untitled module')
        sessions.append({
            'source': 'occurrence',
            'occurrenceId': occurrence['id'], 'seriesId': series_id,
            'moduleId': module_id or f'live-session:{series_id}',
            'title': _text(component.get('component_title')) or _text(occurrence.get('series_module_title'))
                     or module_title,
            'moduleTitle': module_title,
            'programme': _text(occurrence.get('programme_name')),
            'programmeActive': programme_active(occurrence.get('programme_status')),
            'archived': bool(occurrence.get('module_archived')),
            'cohort': _text(occurrence.get('cohort_name')),
            'group': _text(occurrence.get('group_name')),
            'weekId': component.get('week_id'), 'weekNumber': component.get('week_number'),
            'weekTitle': _text(component.get('week_title')),
            'startsAt': _iso(occurrence.get('scheduled_start')),
            'endsAt': _iso(occurrence.get('scheduled_end')),
            'sessionNumber': occurrence.get('session_number'),
            'status': 'cancelled' if cancelled else _text(occurrence.get('status')),
            'joinUrl': '' if cancelled else _text(occurrence.get('join_url')),
            'attentionStatus': verdict[0] if verdict else None,
            'attentionReason': verdict[1] if verdict else '',
        })
    for component in components:
        if id(component) in matched:
            continue
        settings = _settings(component.get('settings_json'))
        start = _component_start(settings)
        if not start:
            continue
        try:
            duration = int(settings.get('durationMinutes') or settings.get('teamsDurationMinutes') or 60)
        except (TypeError, ValueError):
            duration = 60
        duration = duration if 0 < duration <= 24 * 60 else 60
        module_title = _text(component.get('module_title')) or 'Untitled module'
        sessions.append({
            'source': 'authored',
            'occurrenceId': f"authored:{component['component_id']}", 'seriesId': '',
            'moduleId': component['module_catalogue_id'],
            'title': _text(component.get('component_title')) or module_title,
            'moduleTitle': module_title,
            'programme': _text(component.get('programme_name')),
            'programmeActive': programme_active(component.get('programme_status')),
            'archived': bool(component.get('module_archived')),
            'cohort': _text(component.get('cohort_name')),
            'group': _text(component.get('group_name')),
            'weekId': component.get('week_id'), 'weekNumber': component.get('week_number'),
            'weekTitle': _text(component.get('week_title')),
            'startsAt': _iso(start), 'endsAt': _iso(start + timedelta(minutes=duration)),
            'sessionNumber': None, 'status': 'planned', 'joinUrl': '',
            'attentionStatus': None, 'attentionReason': '',
        })
    return sorted(sessions, key=lambda item: (item['startsAt'] or '', str(item['occurrenceId'])))


def _delivery(row, archived=False):
    return {'moduleId': row['module_catalogue_id'], 'title': _text(row.get('module_title')) or 'Untitled module',
            'programme': _text(row.get('programme_name')), 'programmeActive': programme_active(row.get('programme_status')),
            'archived': archived, 'cohort': _text(row.get('cohort_name')), 'group': _text(row.get('group_name')),
            'weeks': {}, 'attention': []}


def build_library(recordings, weeks, components, attention=None, placement_reviews=None):
    owners = week_owners(components)
    placement_reviews = placement_reviews or set()
    week_rows = {row['id']: row for row in weeks}
    week_order = {row['id']: index for index, row in enumerate(weeks)}
    deliveries, kept = {}, {}
    for row in recordings:
        key = same_recording_key(row)
        if key in kept:
            first = kept[key]
            first['duplicateCount'] += 1
            # Show the copy that can be played when only one of them can.
            if first['status'] != 'available' and recording_status(row.get('archive_status')) == 'available':
                first.update(id=row['artifact_id'], seriesId=row['series_id'], status='available', state='ready')
            continue
        delivery = deliveries.setdefault(row['module_catalogue_id'], _delivery(row, bool(row.get('module_archived'))))
        week_id = recording_week(row, owners)
        week = week_rows.get(week_id) if week_id else None
        week_key = week['id'] if week else ''
        bucket = delivery['weeks'].setdefault(week_key, {
            'weekId': week_key or None,
            'weekNumber': week.get('week_number') if week else None,
            'title': _text(week.get('title')) if week else '',
            'order': week_order.get(week_key, len(week_order)),
            'recordings': []})
        state = _text(row.get('archive_status')) or 'pending'
        recorded = instant(row.get('created_datetime')) if row.get('created_datetime') else None
        recorded_day = recorded.astimezone(ZoneInfo('Europe/London')).date().isoformat() if recorded else ''
        explicitly_placed = bool(owners[3].get((_text(row.get('series_id')), recorded_day)))
        item = {
            'id': row['artifact_id'], 'seriesId': row['series_id'], 'occurrenceId': row.get('occurrence_id'),
            'sessionNumber': row.get('session_number'),
            'startsAt': _iso(row.get('scheduled_start')), 'recordedAt': _iso(row.get('created_datetime')),
            'endsAt': _iso(row.get('end_datetime')),
            'state': state if state in ('pending', 'ready', 'failed') else 'pending',
            'status': recording_status(row.get('archive_status')), 'duplicateCount': 0,
            'placementReview': row['artifact_id'] in placement_reviews and not explicitly_placed,
            'hiddenFromLearners': artifact_metadata(row).get('lmsHiddenFromLearners') is True}
        kept[key] = item
        bucket['recordings'].append(item)
    for module_id, entry in (attention or {}).items():
        delivery = deliveries.setdefault(module_id, _delivery(entry['row']))
        delivery['attention'] = entry['sessions']
    result = []
    order = lambda item: tuple(item[key].casefold() for key in ('programme', 'cohort', 'group', 'title')) + (str(item['moduleId']),)
    for delivery in sorted(deliveries.values(), key=order):
        # Unmatched recordings sort last; matched weeks follow the module's own order.
        weeks_out = sorted(delivery['weeks'].values(), key=lambda item: (item['weekId'] is None, item['order']))
        for week in weeks_out:
            week.pop('order')
        result.append({**delivery, 'weeks': weeks_out,
                       'recordingCount': sum(len(week['recordings']) for week in weeks_out)})
    return {'deliveries': result, 'recordingCount': sum(delivery['recordingCount'] for delivery in result),
            'attentionChecked': attention is not None}


@require_GET
@require_role('admin', 'staff')
def recordings_library(request):
    try:
        modules = module_index(read(MODULES_SQL))
        recordings = read(RECORDINGS_SQL)
        module_ids = sorted({row['module_catalogue_id'] for row in recordings})
        weeks = read(WEEKS_SQL, [module_ids]) if module_ids else []
        components = read(LIVE_COMPONENTS_SQL, [module_ids]) if module_ids else []
    except DatabaseError:
        return unavailable()
    placement_reviews = set()
    try:
        now = datetime.now(timezone.utc)
        schedule_components = read(ATTENTION_COMPONENTS_SQL)
        calendar_components = read(CALENDAR_COMPONENTS_SQL)
        occurrences = read(OCCURRENCES_SQL)
        placement_reviews = placement_review_ids(recordings, occurrences)
        confirmed_occurrences = {row['occurrence_id'] for row in recordings
                                 if row['artifact_id'] not in placement_reviews}
        for occurrence in occurrences:
            occurrence['has_recording'] = occurrence['id'] in confirmed_occurrences
        attention = attention_by_module(schedule_components, occurrences, now)
        sessions = calendar_sessions(calendar_components, occurrences, now)
        calendar_available = True
    except DatabaseError:
        # The recordings still list, but an empty calendar would be misleading.
        attention = None
        sessions = []
        calendar_available = False
    payload = build_library(recordings, weeks, components, attention, placement_reviews)
    payload['modules'] = modules
    payload['sessions'] = sessions
    payload['calendarAvailable'] = calendar_available
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response
