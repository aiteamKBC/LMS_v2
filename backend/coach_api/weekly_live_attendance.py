"""Read-only bridge from the learner attendance register to Weekly Learning."""
from datetime import timezone
from zoneinfo import ZoneInfo

from learner_api.attendance_rules import attendance_outcome, INVALID
from learner_api.subject_content import safe_url

LONDON = ZoneInfo('Europe/London')


def read_weekly_live_evidence(source, owner, schedule_ids, content_ids):
    from learner_api.attendance_lectures import lecture_register
    from learner_api.live_session_progress import read_live_credits
    register = lecture_register(source, module_ids=schedule_ids, learner_profile_id=owner['id'])
    register = [row for row in register if row.get('source') == 'microsoft-teams'
                and row.get('module_catalogue_id') in schedule_ids]
    credits = read_live_credits(source, module_ids=content_ids, register=register)
    dates = {(row['module_catalogue_id'], str(row.get('attendance_source_occurrence_id')
              or row.get('occurrence_id') or row.get('session_id'))): str(row.get('session_date'))
             for row in register}
    return register, [{**credit, 'sessionDate': dates.get((credit['moduleId'], credit['occurrenceId'])) or credit.get('sessionDate')}
                      for credit in credits]


def credit_in_week(credit, week):
    return (week['kind'] != 'reading-week' and credit['moduleId'] == week['moduleId']
            and bool(credit.get('sessionDate'))
            and week['startDate'] <= credit['sessionDate'] <= week['endDate'])


def week_live_session(register, week, now):
    """Earliest valid occurrence in this delivery week, including shared meetings."""
    if week['kind'] == 'reading-week':
        return None
    candidates = []
    for row in register:
        if row.get('module_catalogue_id') != week['moduleId'] or not row.get('scheduled_start'):
            continue
        if any(str(row.get(key) or '').strip().lower() in INVALID
               for key in ('status', 'session_status', 'occurrence_status', 'attendance_status')):
            continue
        start = row['scheduled_start']
        start = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start
        day = start.astimezone(LONDON).date().isoformat()
        if week['startDate'] <= day <= week['endDate']:
            candidates.append((start, str(row.get('session_id') or ''), row))
    if not candidates:
        return None
    start, identity, row = min(candidates, key=lambda item: item[:2])
    end = row.get('scheduled_end')
    end = end.replace(tzinfo=timezone.utc) if end and end.tzinfo is None else end
    outcome, _ = attendance_outcome(row, now)
    state = {'present': 'attended', 'absent': 'missed', 'in_progress': 'live'}.get(outcome, outcome)
    local = start.astimezone(LONDON)
    return {'id': identity, 'title': row.get('session_title') or row.get('module_title') or 'Live session',
            'date': local.date().isoformat(), 'startTime': local.strftime('%H:%M'),
            'endTime': end.astimezone(LONDON).strftime('%H:%M') if end else None,
            'start': start.isoformat(), 'durationMinutes': (end-start).total_seconds()/60 if end else None,
            'status': 'scheduled' if start > now else 'completed' if end and end <= now else 'in_progress',
            'sessionState': state, 'attended': True if outcome == 'present' else False if outcome == 'absent' else None,
            'joinUrl': safe_url(row.get('join_url')) or None}


def add_live_activity_hours(activity_hours, records, credits):
    from learner_api.live_session_progress import supplement_module_hours
    result = {mid: {bucket: dict(values) for bucket, values in hours.items()}
              for mid, hours in activity_hours.items()}
    seen = set()
    for credit in credits:
        mid, cid = credit['moduleId'], credit['componentId']
        if cid in seen or mid not in result:
            continue
        seen.add(cid)
        extra = supplement_module_hours({mid: {'hours': {'actual': 0}}}, records, [credit])
        result[mid]['components'][cid] = round(result[mid]['components'].get(cid, 0)
                                               + extra[mid]['hours']['actual'], 4)
    return result
