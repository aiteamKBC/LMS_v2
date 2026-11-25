"""Deterministic meeting decisions over Python values and explicit pure helpers."""

import hashlib
import json
import re
from ...catalogue.domain.values import clean_str
from .instants import parse_graph_datetime
from .invitation_policy import teams_series_email_list


def closest_live_occurrence(occurrences, timestamp):
    if not occurrences or not timestamp:
        return None
    comparable_timestamp = timestamp.replace(tzinfo=None)

    def distance(row):
        scheduled = row.get('scheduled_start') or timestamp
        return abs((scheduled.replace(tzinfo=None) - comparable_timestamp).total_seconds())

    return min(
        occurrences,
        key=distance,
    )


def launch_linked_live_occurrence(occurrences, timestamp, launches, report_id=''):
    """Resolve a Graph run to the Week whose Join button opened it.

    Graph reports identify the online meeting and run time, but not the calendar
    occurrence. The LMS redirect records that missing context. Existing report
    bindings win on re-sync; a launch within 24 hours wins for a new run; the
    scheduled-date heuristic remains only for historical runs with no launch log.
    """
    if not occurrences or not timestamp:
        return None, None
    if report_id:
        stored = next((row for row in occurrences if clean_str(row.get('attendance_report_id')) == clean_str(report_id)), None)
        if stored:
            return stored, None
    by_id = {clean_str(row.get('id')): row for row in occurrences}
    report_id = clean_str(report_id)
    if report_id:
        exact = next(
            (row for row in launches if clean_str(row.get('attendance_report_id')) == report_id),
            None,
        )
        occurrence = by_id.get(clean_str((exact or {}).get('occurrence_id')))
        if occurrence:
            return occurrence, exact

    moment = timestamp.replace(tzinfo=None)
    candidates = []
    for launch in launches:
        bound_report_id = clean_str(launch.get('attendance_report_id'))
        if report_id and bound_report_id and bound_report_id != report_id:
            # A click that has already been matched to one Teams run must not
            # be reused by a later report from the same shared meeting URL.
            continue
        occurrence = by_id.get(clean_str(launch.get('occurrence_id')))
        launched_at = parse_graph_datetime(launch.get('launched_at'))
        if not occurrence or not launched_at:
            continue
        delta = (moment - launched_at.replace(tzinfo=None)).total_seconds()
        # A browser normally opens Teams just before the report starts. Allow a
        # small clock/order skew and long teaching sessions, without letting an
        # old test click steal a later week's real report.
        if -900 <= delta <= 86400:
            candidates.append((abs(delta), launch, occurrence))
    if candidates:
        _distance, launch, occurrence = min(candidates, key=lambda item: item[0])
        return occurrence, launch
    return closest_live_occurrence(occurrences, timestamp), None


def attendance_identity(record):
    identity = record.get('identity') if isinstance(record.get('identity'), dict) else {}
    for key in ('user', 'guest', 'phone', 'encrypted'):
        value = identity.get(key)
        if isinstance(value, dict):
            display_name = clean_str(value.get('displayName') or value.get('name'))
            identity_id = clean_str(value.get('id'))
            if display_name or identity_id:
                return display_name, identity_id
    return '', ''


def attendance_display_name(record):
    if not isinstance(record, dict):
        return ''
    display_name, _identity_id = attendance_identity(record)
    if display_name:
        return display_name
    for key in ('displayName', 'participantDisplayName', 'name'):
        display_name = clean_str(record.get(key))
        if display_name:
            return display_name
    email = clean_str(record.get('emailAddress') or record.get('email')).lower()
    if email and '@' in email:
        local = email.split('@', 1)[0]
        return ' '.join(part.capitalize() for part in re.split(r'[._-]+', local) if part)
    return ''


def merge_attendance_intervals(*interval_groups):
    """Keep every distinct join/leave visit returned across Graph reports."""
    merged = []
    seen = set()
    for intervals in interval_groups:
        for interval in intervals if isinstance(intervals, list) else []:
            if not isinstance(interval, dict):
                continue
            key = (
                clean_str(interval.get('joinDateTime')),
                clean_str(interval.get('leaveDateTime')),
            )
            if key == ('', ''):
                key = (json.dumps(interval, sort_keys=True, default=str), '')
            if key in seen:
                continue
            seen.add(key)
            merged.append(interval)
    merged.sort(key=lambda item: clean_str(item.get('joinDateTime')))
    return merged


def attendance_roster(series, actual_rows, include_absent=False):
    """Merge the invitation roster with Graph attendance for UI/reporting."""
    expected_roles = {}
    organizer = clean_str(series.get('organizer_email')).lower()
    if organizer:
        expected_roles[organizer] = 'Organizer'
    for email in teams_series_email_list(series.get('attendees')):
        expected_roles.setdefault(email, 'Attendee')
    for email in teams_series_email_list(series.get('presenters')):
        expected_roles[email] = 'Presenter'
    for email in teams_series_email_list(series.get('co_organizers')):
        expected_roles[email] = 'Co-organizer'

    rows = []
    actual_emails = set()
    for row in actual_rows:
        email = clean_str(row.get('email')).lower()
        if email:
            actual_emails.add(email)
        intervals = row.get('intervals') if isinstance(row.get('intervals'), list) else []
        row['attended'] = int(row.get('total_attendance_seconds') or 0) > 180
        row['expected'] = bool(email and email in expected_roles)
        row['join_count'] = len(intervals)
        rows.append(row)

    for email, role in expected_roles.items() if include_absent else []:
        if email in actual_emails:
            continue
        rows.append({
            'id': 'EXPECTED-' + hashlib.sha256(email.encode('utf-8')).hexdigest()[:24].upper(),
            'occurrence_id': '',
            'graph_record_id': '',
            'email': email,
            'display_name': attendance_display_name({'emailAddress': email}),
            'role': role,
            'total_attendance_seconds': 0,
            'intervals': [],
            'raw_data': {},
            'attended': False,
            'expected': True,
            'join_count': 0,
        })

    rows.sort(key=lambda row: (
        not bool(row.get('expected')),
        not bool(row.get('attended')),
        clean_str(row.get('display_name') or row.get('email')).lower(),
    ))
    return rows


def attendance_report_rosters(series, actual_rows, include_absent=False):
    """Return one complete expected-vs-attended roster per Graph meeting run.

    A recurring Teams link can be opened on different days. Microsoft publishes
    one attendance report per run and can reuse the same attendee record id in
    those reports, so collapsing rows by attendee would incorrectly turn two
    different days into two rejoins in one session.
    """
    groups = {}
    for source_row in actual_rows:
        row = dict(source_row)
        raw = row.get('raw_data') if isinstance(row.get('raw_data'), dict) else {}
        source_report_ids = raw.get('sourceAttendanceReportIds')
        report_id = clean_str(raw.get('attendanceReportId'))
        if not report_id and isinstance(source_report_ids, list) and len(source_report_ids) == 1:
            report_id = clean_str(source_report_ids[0])
        report_start = clean_str(raw.get('attendanceReportStart'))
        report_end = clean_str(raw.get('attendanceReportEnd'))
        group_key = report_id or report_start or 'legacy'
        group = groups.setdefault(group_key, {
            'report_id': report_id,
            'report_start': report_start,
            'report_end': report_end,
            'rows': [],
        })
        group['rows'].append(row)

    flattened = []
    ordered_groups = sorted(
        groups.values(),
        key=lambda group: group.get('report_start') or '',
        reverse=True,
    )
    for group in ordered_groups:
        report_key = group.get('report_id') or group.get('report_start') or 'legacy'
        roster = attendance_roster(series, group['rows'], include_absent=include_absent)
        for row in roster:
            if row.get('attended') is False:
                row['id'] = f"{row['id']}-{hashlib.sha256(report_key.encode('utf-8')).hexdigest()[:12].upper()}"
            row['attendance_report_id'] = group.get('report_id') or ''
            row['attendance_report_start'] = group.get('report_start') or ''
            row['attendance_report_end'] = group.get('report_end') or ''
            flattened.append(row)
    return flattened


def safe_float(value, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number or number in (float('inf'), float('-inf')):
        return default
    return number
