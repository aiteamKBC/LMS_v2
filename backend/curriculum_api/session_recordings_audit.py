"""Read-only comparison of Teams recordings with the LMS and private archive."""

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from azure.core.exceptions import ResourceNotFoundError

from coach_api.views import get_graph_settings, microsoft_graph_request

from .session_archive import storage_client
from .session_artifact_placement import recording_matches_occurrence
from .session_component_identity import TIMEZONE_ALIASES, occurrence_fallbacks
from .session_graph import collection
from .session_results import read
from .teams_permission_check import read_only
from .views import launch_linked_live_occurrence, live_session_meeting_groups


def _text(value):
    return str(value or '').strip()


def _instant(value):
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(_text(value).replace('Z', '+00:00'))
        except ValueError:
            return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def _issue(code, series_id, *, artifact_id='', occurrence_id='', http_status=''):
    return {key: value for key, value in {
        'code': code, 'seriesId': series_id, 'artifactId': artifact_id,
        'occurrenceId': occurrence_id, 'httpStatus': http_status,
    }.items() if value}


def _placement_issue(series, group, artifact, stored):
    """Flag uncertain dates for review; never reassign historical evidence."""
    started = _instant(artifact.get('createdDateTime'))
    if not started:
        return None
    zone_name = TIMEZONE_ALIASES.get(_text(series.get('timezone')), _text(series.get('timezone')) or 'Europe/London')
    try:
        local_date = started.astimezone(ZoneInfo(zone_name)).date().isoformat()
    except ZoneInfoNotFoundError:
        return None
    identities = occurrence_fallbacks(
        (series['module_catalogue_id'], series['id'], series.get('timezone'),
         row['id'], row['session_number'], row['scheduled_start']) for row in group
    )
    same_day = identities.get((_text(series['module_catalogue_id']), local_date))
    if same_day and same_day['teamsOccurrenceId'] != stored['occurrence_id']:
        return _issue('placement_review', series['id'], artifact_id=stored['id'],
                      occurrence_id=stored['occurrence_id'])
    scheduled = next((_instant(row.get('scheduled_start')) for row in group
                      if row['id'] == stored['occurrence_id']), None)
    if not same_day and scheduled and abs(started - scheduled) > timedelta(hours=12):
        return _issue('placement_review', series['id'], artifact_id=stored['id'],
                      occurrence_id=stored['occurrence_id'])
    return None


def audit_recordings(series_ids=()):
    """GET Teams metadata and HEAD archived blobs; do not write or download media."""
    requested = list(dict.fromkeys(_text(value) for value in series_ids if _text(value)))
    scope = ' AND s.id=ANY(%s)' if requested else ''
    series_rows = read('''SELECT s.id,s.module_catalogue_id,s.organizer_email,s.join_url,
                              s.online_meeting_id,s.timezone,s.status
                         FROM curriculum.live_sessions s
                         JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
                         WHERE m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
                           AND s.status NOT IN ('cancelled','deleted','superseded','failed')''' + scope +
                       ' ORDER BY s.id', [requested] if requested else [])
    issues = []
    found = {row['id'] for row in series_rows}
    for missing in requested:
        if missing not in found:
            issues.append(_issue('series_not_found', missing))
    if not series_rows:
        return {'seriesChecked': 0, 'graphRecordings': 0, 'savedRecordings': 0,
                'readyRecordings': 0, 'issues': issues}

    ids = [row['id'] for row in series_rows]
    occurrences = read('''SELECT id,live_session_id,session_number,scheduled_start,status,
                                 join_url,online_meeting_id
                          FROM curriculum.live_session_occurrences
                          WHERE live_session_id=ANY(%s)''', [ids])
    launches = read('''SELECT l.occurrence_id,l.launched_at,l.attendance_report_id,
                             o.live_session_id
                      FROM curriculum.live_session_join_launches l
                      JOIN curriculum.live_session_occurrences o ON o.id=l.occurrence_id
                      WHERE o.live_session_id=ANY(%s)''', [ids])
    saved = read('''SELECT a.id,a.occurrence_id,a.graph_artifact_id,o.live_session_id,
                           r.status AS archive_status,r.container,r.blob_name
                    FROM curriculum.live_session_artifacts a
                    JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
                    LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id
                    WHERE o.live_session_id=ANY(%s) AND a.artifact_type='recording' ''', [ids])
    by_series = {series_id: [] for series_id in ids}
    for row in occurrences:
        by_series[row['live_session_id']].append(row)
    saved_by_series = {series_id: [] for series_id in ids}
    for row in saved:
        saved_by_series[row['live_session_id']].append(row)
    launches_by_series = {series_id: [] for series_id in ids}
    for row in launches:
        launches_by_series[row['live_session_id']].append(row)

    # A ready database row is not proof that Azure still holds the blob.
    client = None
    for row in saved:
        if row.get('archive_status') != 'ready':
            issues.append(_issue('archive_not_ready', row['live_session_id'],
                                 artifact_id=row['id'], occurrence_id=row['occurrence_id']))
            continue
        try:
            client = client or storage_client()
            if not row.get('container') or not row.get('blob_name'):
                issues.append(_issue('blob_missing', row['live_session_id'],
                                     artifact_id=row['id'], occurrence_id=row['occurrence_id']))
                continue
            properties = client.get_blob_client(row['container'], row['blob_name']).get_blob_properties(
                logging_enable=False)
            if properties.size == 0:
                issues.append(_issue('empty_blob', row['live_session_id'],
                                     artifact_id=row['id'], occurrence_id=row['occurrence_id']))
        except ResourceNotFoundError:
            issues.append(_issue('blob_missing', row['live_session_id'],
                                 artifact_id=row['id'], occurrence_id=row['occurrence_id']))
        except Exception:
            issues.append(_issue('storage_check_failed', row['live_session_id'],
                                 artifact_id=row['id'], occurrence_id=row['occurrence_id']))

    graph_settings = get_graph_settings()
    graph_get = read_only(microsoft_graph_request)
    graph_count = 0
    for series in series_rows:
        rows = by_series[series['id']]
        matched_occurrences = set()
        checked_occurrences = set()
        groups = live_session_meeting_groups(series, rows)
        grouped_ids = {row['id'] for _, group in groups for row in group}
        for row in rows:
            if row['id'] not in grouped_ids and row.get('status') not in ('cancelled', 'deleted', 'superseded'):
                issues.append(_issue('meeting_identity_missing', series['id'], occurrence_id=row['id']))
        for base, group in groups:
            group_ids = {row['id'] for row in group}
            try:
                graph_items = collection(graph_get, f'{base}/recordings', graph_settings['base_url'])
            except RuntimeError as error:
                status = re.search(r'\bHTTP ([1-5][0-9]{2})\b', str(error))
                issues.append(_issue('graph_check_failed', series['id'],
                                     http_status=status.group(1) if status else ''))
                continue
            checked_occurrences.update(group_ids)
            for artifact in graph_items:
                graph_count += 1
                graph_id = _text(artifact.get('id'))
                if not graph_id:
                    issues.append(_issue('graph_id_missing', series['id']))
                    continue
                stored = next((row for row in saved_by_series[series['id']]
                               if row['occurrence_id'] in group_ids and row['graph_artifact_id'] == graph_id), None)
                if not stored:
                    timestamp = _instant(artifact.get('createdDateTime') or artifact.get('endDateTime'))
                    candidate, launch = launch_linked_live_occurrence(
                        group, timestamp, launches_by_series[series['id']])
                    code = ('not_imported' if candidate and recording_matches_occurrence(
                        artifact, candidate, linked_by_launch=bool(launch)) else 'unplanned_recording')
                    issues.append(_issue(code, series['id'], artifact_id=graph_id))
                    continue
                matched_occurrences.add(stored['occurrence_id'])
                placement = _placement_issue(series, group, artifact, stored)
                if placement:
                    issues.append(placement)
        for row in rows:
            if row.get('status') == 'completed' and row['id'] in checked_occurrences and row['id'] not in matched_occurrences and not any(
                    saved_row['occurrence_id'] == row['id'] for saved_row in saved_by_series[series['id']]):
                issues.append(_issue('completed_without_recording', series['id'], occurrence_id=row['id']))

    return {'seriesChecked': len(series_rows), 'graphRecordings': graph_count,
            'savedRecordings': len(saved),
            'readyRecordings': sum(row.get('archive_status') == 'ready' for row in saved),
            'issues': sorted(issues, key=lambda item: (item['seriesId'], item['code'],
                                                       item.get('occurrenceId', ''), item.get('artifactId', '')))}
