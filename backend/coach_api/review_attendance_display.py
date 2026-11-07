"""Read-only, appointment-scoped attendance labels for MCM/PR lists.

Only already-authorized calendar events enter this reader. No Graph calls,
attendance credits, review transitions or schema helpers run here.
"""
import logging
from collections import defaultdict

from django.db import DatabaseError, connections, router

from .meeting_outcomes import LEARNER_ATTENDED_SECONDS, _ended_at, _parse_time
from .models import CoachCalendarEvent, ReviewAttendanceLink

logger = logging.getLogger(__name__)


def applies(event):
    if event.get('importedReviewType') is not None:
        from .migrated_templates import template_family
        return template_family(event['importedReviewType']) in {'MCM', 'PR', 'PR_SKILLS_RADAR'}
    code = str(event.get('reviewTypeCode') or '').lower()
    return code in {'mcm', 'progress_review'} if code else event.get('source') in {'mcr', 'progress-review'}


def same_booking(event, record):
    """Reject stale serialized slots; never join by learner name or email."""
    return bool(record and record.graph_event_id
        and record.status in {'scheduled', 'in-progress'}
        and str(record.scheduled_date) == event.get('scheduledDate')
        and record.scheduled_time == _parse_time(event.get('scheduledTime'))
        and int(record.duration_minutes or 30) == int(event.get('durationMinutes') or 30)
        and (not event.get('ownerEmail') or record.owner_email.casefold() == event['ownerEmail'].casefold()))


def read_evidence(keys):
    """Three bounded reads, independent of the number of meetings in the list."""
    database = router.db_for_read(CoachCalendarEvent) or 'default'
    records = {record.event_key: record for record in CoachCalendarEvent.objects.using(database).filter(event_key__in=keys)}
    reports = defaultdict(list)
    links = defaultdict(list)
    if not records:
        return records, reports, links
    with connections[database].cursor() as cursor:
        cursor.execute('''SELECT event_key, graph_event_id, graph_report_id,
                meeting_start_datetime, meeting_end_datetime, metadata
            FROM "Coach".coach_meeting_attendance_reports WHERE event_key = ANY(%s)''', [list(records)])
        rows = cursor.fetchall()
    from .views import parse_jsonish
    for key, graph_id, report_id, start, end, metadata in rows:
        if graph_id != records[key].graph_event_id:
            continue
        data = parse_jsonish(metadata, {})
        if not isinstance(data, dict) or not isinstance(data.get('records'), list):
            reports[key].append({'invalid': True})
            continue
        reports[key].append({**data, 'id': report_id, 'meetingStartDateTime': start.isoformat() if start else '',
                             'meetingEndDateTime': end.isoformat() if end else '', '_lms_graph_event_id': graph_id})
    for link in ReviewAttendanceLink.objects.using(database).filter(
            calendar_event_id__in=[record.pk for record in records.values()], target_role='learner', revoked_at__isnull=True):
        links[link.calendar_event_id].append(link)
    return records, reports, links


def outcome(record, reports, links, *, native=False):
    from .migrated_session_scope import (
        booking_fingerprint, current_reports, has_verified_meeting_evidence,
        report_window, scope_snapshot,
    )
    from .review_attendance_links import project_attendance
    from .views import build_coach_meeting_attendance_tracker
    if not record.learner_email:
        return 'unavailable'
    if any(report.get('invalid') or not all(report_window(report))
           or report_window(report)[0] >= report_window(report)[1] for report in reports):
        return 'unavailable'
    # A reused Teams meeting must not carry the previous appointment's result.
    fingerprint = booking_fingerprint(record)
    reports = [report for report in reports
               if report.get('_lms_booking_fingerprint') in (None, '', fingerprint)]
    scoped = current_reports(record, {'attendanceReports': reports})
    if not native and has_verified_meeting_evidence({'attendanceReports': reports}):
        # Use the Imported form's verified meeting reader, including its stricter
        # occurrence selection after rescheduling. Planned hours alone must not
        # hide a report already accepted for this meeting by the form.
        if any(not isinstance(report.get('records'), list)
               or any(not isinstance(row, dict) for row in report['records']) for report in reports):
            return 'unavailable'
        snapshot = scope_snapshot(record, {'attendanceReports': reports}, meeting_scoped=True)
        if snapshot.get('selectionError'):
            return 'unavailable'
        scoped = snapshot['attendanceReports']
    elif native and len(scoped) != len(reports):
        # Match the Native form: a saved report belongs to this provider meeting
        # even if the call started outside its planned hours. Only a replacement
        # appointment needs the stricter window; never reuse its prior evidence.
        from .review_rescheduling import previous_bookings
        if not previous_bookings(record):
            scoped = reports
    reports = scoped
    if not reports:
        return 'pending'
    expected = [{'id': 'learner', 'role': 'learner', 'email': record.learner_email,
                 'displayName': record.learner_name or 'Learner', 'required': True}]
    actual = [row for report in reports for row in report['records']]
    if any(not isinstance(row, dict) for row in actual):
        return 'unavailable'
    tracker = build_coach_meeting_attendance_tracker(expected, actual, has_report=True)
    attendance = project_attendance(record, {'reports': reports, **tracker}, links)
    if attendance.get('linkWarning'):
        return 'unavailable'
    learner = next(row for row in attendance['tracker'] if row['expected'] and row['role'] == 'learner')
    # Preserve the existing display threshold; do not change attendance credits.
    return 'attended' if learner['totalAttendanceSeconds'] > LEARNER_ATTENDED_SECONDS else 'missed'


def annotate_review_attendance(events, *, now_local):
    eligible = []
    for event in events:
        if not isinstance(event, dict) or not applies(event):
            continue
        event['reviewAttendance'] = None
        if event.get('status') not in {'scheduled', 'in-progress'}:
            continue
        if event.get('reviewSource') == 'aptem' and not event.get('calendarEventKey'):
            continue
        end = _ended_at(event)
        if end is not None and end <= now_local:
            eligible.append(event)
    if not eligible:
        return
    keys = {event.get('calendarEventKey') or event.get('eventKey') for event in eligible} - {None, ''}
    try:
        records, reports, links = read_evidence(sorted(keys))
        for event in eligible:
            key = event.get('calendarEventKey') or event.get('eventKey')
            record = records.get(key)
            if not same_booking(event, record):
                event['reviewAttendance'] = 'unavailable'
                continue
            native = (event.get('reviewSource') != 'aptem'
                      and event.get('importedReviewType') is None
                      and not record.event_key.startswith('imported-review:'))
            event['reviewAttendance'] = outcome(record, reports.get(key, []), links.get(record.pk, []), native=native)
    except (DatabaseError, TypeError, ValueError, KeyError):
        # A failed read is neither absence nor an empty successful report.
        logger.warning('Review attendance display is unavailable; saved review states are unchanged.')
        for event in eligible:
            event['reviewAttendance'] = 'unavailable'
