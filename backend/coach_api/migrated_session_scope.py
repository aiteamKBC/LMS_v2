"""Select one booked call without deleting historical Teams evidence."""
from datetime import datetime, timedelta, timezone as utc_timezone
import hashlib
import json
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime


def instant(value):
    try:
        value = parse_datetime(value) if isinstance(value, str) else value
        return value.astimezone(utc_timezone.utc) if isinstance(value, datetime) and timezone.is_aware(value) else None
    except (TypeError, ValueError):
        return None


def booking_window(record):
    if not record.scheduled_date or not record.scheduled_time:
        return None, None
    start = datetime.combine(record.scheduled_date, record.scheduled_time, ZoneInfo(settings.TIME_ZONE))
    start = start.astimezone(utc_timezone.utc)
    return start, start + timedelta(minutes=record.duration_minutes or 60)


def report_window(report):
    return instant(report.get('meetingStartDateTime')), instant(report.get('meetingEndDateTime'))


def current_reports(record, snapshot):
    start, end = booking_window(record)
    if not start:
        return []
    return [report for report in snapshot.get('attendanceReports', [])
            if (bounds := report_window(report))[0] and bounds[1]
            and bounds[0] < bounds[1] and bounds[0] < end and bounds[1] > start]


def validate_attendance_response(response, *, report=None):
    """Imported refresh must not turn missing/partial records into absence.

    Keep the generic/Native serializer unchanged. Unsupported continuation is
    an explicit resource failure, so a previously verified report can survive.
    """
    if report is None:
        if (not isinstance(response, dict) or not isinstance(response.get('value'), list)
                or response.get('@odata.nextLink')
                or any(not isinstance(row, dict) or not isinstance(row.get('id'), str)
                       or not row['id'].strip() for row in response['value'])):
            raise RuntimeError('Teams returned an incomplete attendance report collection.')
        return
    if (not isinstance(response, dict) or response.get('id') != report.get('id')
            or not isinstance(response.get('attendanceRecords'), list)
            or any(not isinstance(row, dict) for row in response['attendanceRecords'])
            or response.get('attendanceRecords@odata.nextLink') or response.get('@odata.nextLink')):
        raise RuntimeError('Teams returned incomplete or mismatched attendance report details.')


def attendance_reports_for_refresh(record, snapshot, previous, *, preserve_existing=False):
    """Preserve current-target stored evidence on an incomplete imported fetch.

    The stored snapshot reader already qualifies reports by Graph event. Both
    inputs still need booking-window qualification. Fresh complete copies win
    by report ID; one report must never contribute its duration twice.
    """
    fresh = current_reports(record, snapshot)
    failed = ((snapshot.get('resourceErrors') or {}).get('attendance')
              or any('attendance' in message.lower() for message in snapshot.get('errors', [])))
    cached = current_reports(record, previous) if preserve_existing or failed or not fresh else []
    return list({row['id']: row for row in [*cached, *fresh] if row.get('id')}.values())


def snapshot_version(snapshot):
    """Optimistic resource version, without relying on clocks across workers."""
    from django.core.serializers.json import DjangoJSONEncoder
    state = {key: snapshot.get(key) for key in ('artifacts', 'attendanceReports', 'attendanceTracker', 'storage')}
    return hashlib.sha256(json.dumps(state, cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()


def persist_imported_snapshot(record, snapshot, *, expected_version, revalidate=None, preserve_existing=False, context=None, start_review=None):
    """Serialize imported writers; reject responses overtaken during Graph I/O.

    Providers run before this function. The current calendar, stored evidence,
    and unchanged snapshot SQL use the same write connection/transaction.
    Native callers retain their original persistence path.
    """
    from django.db import router, transaction
    from .models import CoachCalendarEvent, ImportedReviewInstance
    from .views import persist_coach_meeting_snapshots, stored_coach_meeting_snapshot

    database = router.db_for_write(CoachCalendarEvent) or 'default'
    with transaction.atomic(using=database):
        current = CoachCalendarEvent.objects.using(database).select_for_update().get(pk=record.pk)
        # Same calendar -> overlay order as imported manual/reopen writers.
        # No ensure/get_or_create helper: background writes resources only.
        overlay = None
        if context and context.get('overlayId'):
            overlay = ImportedReviewInstance.objects.using(database).select_for_update().get(pk=context['overlayId'])
        if (refresh_basis(current) != refresh_basis(record)
                or (revalidate is not None and not revalidate(current))):
            return {'stored': False, 'reason': 'snapshot_context_changed'}
        previous = stored_coach_meeting_snapshot(current, database=database, safe_diagnostics=True)
        storage = previous.get('storage') or {}
        if not storage.get('stored') or previous.get('partial'):
            return {'stored': False, 'reason': 'snapshot_read_unavailable'}
        if snapshot_version(previous) != expected_version:
            return {'stored': False, 'reason': 'snapshot_superseded'}
        from .imported_review_start import has_start_evidence, start_locked
        # Evaluate the unfiltered fresh collection: discarding a failed segment
        # before this check would make an incomplete transcript appear complete.
        start_evidence = has_start_evidence(current, snapshot)
        fresh_reports = current_reports(current, snapshot)
        reports = attendance_reports_for_refresh(current, snapshot, previous, preserve_existing=preserve_existing)
        scoped = scope_snapshot(current, {**snapshot, 'attendanceReports': reports})
        for key in ('attendance', 'attendanceReports', 'attendanceTracker'):
            snapshot[key] = scoped[key]
        if context is not None:
            # Background resource writes must not erase a stored transcript
            # after a failed download, or attach a different call's content.
            snapshot['artifacts'] = ([] if scoped['selectionError'] else
                [row for row in scoped['artifacts'] if not row.get('transcript_fetch_error')])
        result = persist_coach_meeting_snapshots(current, artifacts=snapshot['artifacts'],
            attendance_reports=snapshot['attendanceReports'], attendance_tracker=snapshot['attendanceTracker'],
            safe_diagnostics=True)
        if result.get('stored') and start_evidence:
            if start_review is not None:
                owned, family, completed = start_review
            else:
                from .background_meeting_sync import imported_context
                qualified = context if context is not None else imported_context(current)
                owned = overlay
                if qualified and qualified.get('overlayId') and owned is None:
                    owned = ImportedReviewInstance.objects.using(database).select_for_update().get(pk=qualified['overlayId'])
                    # Revalidate after acquiring the overlay lock (e.g. reopen).
                    if imported_context(current) != qualified:
                        return {**result, 'reviewStarted': False}
                family = qualified.get('family') if qualified else None
                completed = qualified.get('completed', False) if qualified else False
            if owned and start_locked(owned, current, family, source_completed=completed):
                record.status = current.status
                result['reviewStarted'] = True
        if context is not None:
            result['resourceRefresh'] = ('partial' if snapshot.get('partial') or scoped['selectionError']
                or any(row.get('transcript_fetch_error') for row in scoped['artifacts']) else
                'updated' if fresh_reports or snapshot['artifacts'] else 'pending')
        return result


def refresh_basis(record):
    return session_provenance(record) | {key: getattr(record, key, None) for key in (
        'event_type', 'sync_state', 'status', 'graph_web_link', 'idempotency_key',
    )}


def select_artifacts(record, snapshot):
    """Use report timing when available, otherwise the booked interval.

    Multiple call IDs/windows or undated transcripts are ambiguous. Never infer
    that an arbitrary first/last transcript belongs to this learner's session.
    """
    start, end = booking_window(record)
    windows = set(report_window(report) for report in current_reports(record, snapshot))
    if len(windows) > 1:
        return [], 'TRANSCRIPT_SESSION_AMBIGUOUS'
    if windows:
        start, end = next(iter(windows))
    if not start:
        return [], 'TRANSCRIPT_SESSION_AMBIGUOUS'
    rows = snapshot.get('artifacts') or []
    anchored, undated = [], []
    for row in rows:
        metadata = row.get('metadata') or {}
        first = instant(row.get('created_datetime') or metadata.get('createdDateTime'))
        last = instant(row.get('end_datetime') or metadata.get('endDateTime'))
        first, last = first or last, last or first
        if not first or last < first:
            undated.append(row)
        elif (start <= first < end if first == last else first < end and last > start):
            anchored.append(row)
    calls = {row.get('call_id') or (row.get('metadata') or {}).get('callId') for row in anchored}
    calls.discard(None)
    calls.discard('')
    if len(calls) > 1:
        return [], 'TRANSCRIPT_SESSION_AMBIGUOUS'
    transcripts = [row for row in anchored if row.get('artifact_type') == 'transcript']
    if len(transcripts) > 1 and any(not (row.get('call_id') or (row.get('metadata') or {}).get('callId')) for row in transcripts):
        return [], 'TRANSCRIPT_SESSION_AMBIGUOUS'
    selected = list(anchored)
    ambiguous = False
    for row in rows:
        if row in anchored:
            continue
        call = row.get('call_id') or (row.get('metadata') or {}).get('callId')
        if call and call in calls:
            selected.append(row)  # Later transcript segments of the same call.
        elif row in undated and row.get('artifact_type') == 'transcript':
            ambiguous = True
    return selected, 'TRANSCRIPT_SESSION_AMBIGUOUS' if ambiguous else None


def scope_snapshot(record, snapshot):
    from .views import build_coach_meeting_attendance_tracker

    reports = current_reports(record, snapshot)
    artifacts, selection_error = select_artifacts(record, snapshot)
    expected = (snapshot.get('attendance') or {}).get('expectedAttendees') or []
    records = [row for report in reports for row in report.get('records', [])]
    tracker = build_coach_meeting_attendance_tracker(expected, records, has_report=bool(reports))
    attendance = {
        'reports': reports, 'records': records, 'expectedAttendees': expected,
        'reportCount': len(reports),
        'participantCount': sum(report.get('totalParticipantCount', 0) for report in reports),
        'attendedCount': sum(report.get('attendedCount', 0) for report in reports),
        'absentCount': sum(report.get('absentCount', 0) for report in reports), **tracker,
    }
    return {**snapshot, 'artifacts': artifacts, 'attendanceReports': reports,
            'attendance': attendance, 'attendanceTracker': tracker, 'selectionError': selection_error}


def stored_transcript_selection(record, snapshot):
    """One contract for stored Native/imported/history/download consumers.

    Metadata without a proven Graph event is not evidence for the current link.
    Keep rejected historical rows intact, but never read their content here.
    """
    graph_id = record.graph_event_id
    artifacts = [row for row in snapshot.get('artifacts', []) if graph_id and
                 (row.get('metadata') or {}).get('_lms_graph_event_id') == graph_id]
    if not artifacts:
        return {'artifactIds': [], 'callId': None, 'provenance': session_provenance(record),
                'status': 'unavailable', 'code': 'TRANSCRIPT_UNAVAILABLE'}
    selected, error = select_artifacts(record, {**snapshot, 'artifacts': artifacts})
    ids = sorted({row['graph_artifact_id'] for row in selected
                  if row.get('artifact_type') == 'transcript' and row.get('graph_artifact_id')}) if not error else []
    calls = {row.get('call_id') or (row.get('metadata') or {}).get('callId') for row in selected} - {None, ''}
    return {'artifactIds': ids, 'callId': next(iter(calls)) if ids and len(calls) == 1 else None,
            'provenance': session_provenance(record), 'status': 'ambiguous' if error else 'ready' if ids else 'unavailable',
            'code': error or (None if ids else 'TRANSCRIPT_UNAVAILABLE')}


def session_provenance(record):
    """Target and booked occurrence; stored inside existing summary JSON only."""
    start, end = booking_window(record)
    return {key: str(getattr(record, key, '') or '') for key in (
        'pk', 'event_key', 'owner_email', 'learner_id', 'graph_event_id',
        'graph_organizer_email', 'meeting_link', 'review_instance_id', 'review_template_id',
    )} | {'start': start.isoformat() if start else None, 'end': end.isoformat() if end else None}


def summary_matches_session(state, record, transcript):
    """Validate Teams suggestion provenance, independently of formal answers."""
    return bool(transcript and state.get('eventKey') == record.event_key
                and state.get('graphEventId') == record.graph_event_id
                and state.get('transcriptArtifactId') == transcript['artifactId']
                and state.get('transcriptHash') == hashlib.sha256(transcript['text'].encode('utf-8')).hexdigest()
                and (not state.get('sessionProvenance') or state['sessionProvenance'] == session_provenance(record)))
