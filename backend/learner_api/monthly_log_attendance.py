"""Owner-scoped Monthly Log attendance; never write progress or Teams data."""
from datetime import datetime, timezone
from collections import defaultdict
from zoneinfo import ZoneInfo

from old_otjh.repository import query
from .monthly_log_sources import decoded, row

UK = ZoneInfo('Europe/London')
SOURCE = 'live_session_learner_attendance'


def instant(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if value is None:
        return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def metadata(value):
    value = decoded(value, {})
    return value if isinstance(value, dict) else {}


def represented(lecture, records):
    """Match saved allocations by occurrence identity, never by title alone."""
    occurrence = str(lecture['occurrence_id'])
    day = lecture['session_date']
    source_ref = f'attendance:{occurrence}'
    lecture_ref = f'teams:{occurrence}-{day}'
    for record in records:
        payload = metadata(record.get('source_payload'))
        declaration = metadata(payload.get('staff_time_entry'))
        if (payload.get('original_source_ref') == source_ref
                or record.get('time_tracking_session_ref') == lecture_ref
                or declaration.get('lecture_id') == lecture_ref):
            return True
        kbc = metadata(payload.get('kbc_attendance'))
        key = record.get('kbc_attendance_key')
        # The saved KBC source is joined against this owner's Aptem identity.
        # Match its exact date/module only when the live register
        # has a single occurrence there; a delayed import must not add hours twice.
        if (lecture.get('unique_kbc_match') and key
                and payload.get('original_source_ref') == f'att:{key}'
                and kbc.get('date') == day and kbc.get('module') == lecture.get('module_title')):
            return True
        settings = metadata(record.get('settings_json'))
        legacy = metadata(settings.get('legacySettings'))
        linked_occurrence = settings.get('teamsOccurrenceId') or legacy.get('teamsOccurrenceId')
        if linked_occurrence:
            if str(linked_occurrence) == occurrence:
                return True
            continue
        # Series-only cards must also identify the session, within its module.
        if str(record.get('module_ref') or '') != str(lecture['module_catalogue_id']):
            continue
        series = settings.get('teamsLiveSessionId')
        if not series or str(series) != str(lecture['live_session_id']):
            continue
        number = settings.get('teamsSessionNumber')
        if number:
            if str(number) == str(lecture['session_number']):
                return True
        elif str(settings.get('sessionDate') or legacy.get('sessionDate') or '')[:10] == day:
            return True
    return False


def read_rows(owner, *, now):
    """Add full scheduled hours for Present, completed occurrences only.

    The first signature freezes this supplement. Older signed months have no
    register rows in their capture and remain unchanged; newly signed months
    retain exactly the attendance reviewed, even if the register later changes.
    """
    signatures = query('''SELECT report_month,signature_data
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND review_confirmed IS TRUE ORDER BY signed_at,id''', [owner['id']])
    signed, result = set(), []
    for signature in signatures:
        month = signature['report_month']
        if month in signed:
            continue
        signed.add(month)
        capture = metadata(signature.get('signature_data'))
        for item in capture.get('rows') or []:
            if (isinstance(item, dict) and item.get('source_system') == SOURCE
                    and item.get('reporting_month') == month):
                result.append(dict(item))

    lectures = query('''SELECT r.occurrence_id,r.module_catalogue_id,
        (o.scheduled_start AT TIME ZONE 'Europe/London')::date AS session_date,
        o.live_session_id,o.session_number,o.scheduled_start,o.scheduled_end,
        m.title AS module_title
        FROM curriculum.live_session_learner_attendance r
        JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id AND o.live_session_id=r.live_session_id
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        JOIN curriculum.modules m ON m.module_catalogue_id=r.module_catalogue_id
        WHERE r.learner_profile_id=%s AND r.attendance_status='present'
          AND lower(coalesce(o.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')
          AND lower(coalesce(s.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')
        ORDER BY o.scheduled_start,r.occurrence_id,r.module_catalogue_id''', [owner['id']])
    candidates = []
    for lecture in lectures:
        start, end = instant(lecture['scheduled_start']), instant(lecture['scheduled_end'])
        if start is None or end is None or end <= start or end > now:
            continue
        day = str(lecture['session_date'] or start.astimezone(UK).date())
        if day[:7] in signed:
            continue
        candidates.append({**lecture, 'session_date': day, 'start': start, 'end': end})
    if not candidates:
        return result

    # Keep existing recorded decisions, including zero-hour staff corrections.
    # Evidence-only attendance events do not represent an hour allocation.
    records = query('''SELECT p.source_payload,p.time_tracking_session_ref,p.module_ref,a.source_key AS kbc_attendance_key,c.settings_json
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learners l ON l.id=p.learner_id
        LEFT JOIN "Learner".source_lms_attendance a ON a.aptem_id=l.aptem_id
          AND substr(p.source_payload->>'original_source_ref',1,4)='att:'
          AND a.source_key=substr(p.source_payload->>'original_source_ref',5)
        LEFT JOIN curriculum.components c ON c.id=coalesce(nullif(p.curriculum_component_ref,''),p.component_ref)
        WHERE p.learner_id=%s AND p.deleted_at IS NULL
          AND ((p.actual_seconds IS NOT NULL AND (p.accepted IS TRUE OR p.actual_basis='staff:module-progress')) OR
            (nullif(p.source_system,'') IS NULL AND p.component_link_source IN ('direct','quiz_ref')
             AND p.kind<>'activity_event' AND p.submitted_at IS NOT NULL))''', [owner['id']])
    by_occurrence = {}
    kbc_matches = defaultdict(set)
    for lecture in candidates:
        by_occurrence.setdefault(str(lecture['occurrence_id']), []).append(lecture)
        kbc_matches[lecture['session_date'], lecture['module_title']].add(str(lecture['occurrence_id']))
    for lecture in candidates:
        lecture['unique_kbc_match'] = len(kbc_matches[lecture['session_date'], lecture['module_title']]) == 1
    for occurrence, matches in by_occurrence.items():
        # One learner may have the same shared occurrence in several modules.
        if any(represented(item, records) for item in matches):
            continue
        lecture = matches[0]
        start, end = lecture['start'], lecture['end']
        hours = (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds() / 3600
        local_start, local_end = start.astimezone(UK), end.astimezone(UK)
        title = f"{lecture['module_title'] or 'Live session'} — Session {lecture['session_number']}"
        item = row(f'attendance:{occurrence}', local_start, title, 'Attendance', hours=hours, planned=hours,
                   group=lecture['module_title'],
                   note='Present in the learner attendance register. Full scheduled lecture hours credited.')
        item.update(source_system=SOURCE, reporting_month=lecture['session_date'][:7],
                    activity_date=lecture['session_date'], actual_hours_recorded=True,
                    actual_status_label='Accepted',
                    timestamp_label=f'{local_start:%H:%M:%S} - {local_end:%H:%M:%S}')
        result.append(item)
    return result
