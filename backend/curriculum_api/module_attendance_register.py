"""Read module activity attendance from the resolved per-learner register.

The register supplies a fixed lecture credit without rewriting Activity Log
allocations or completion. No identity matching by email or database writes.
"""
from collections import defaultdict

from django.utils import timezone
from learner_api.attendance_rules import INVALID
from .learner_activity_attendance import ATTENDED_SECONDS, UK, aware, is_attendance, metadata


def match_session(component, sessions):
    settings = metadata(component.get('settings_json'))
    legacy = metadata(settings.get('legacySettings'))
    occurrence = str(settings.get('teamsOccurrenceId') or legacy.get('teamsOccurrenceId') or '')
    series = str(settings.get('teamsLiveSessionId') or legacy.get('teamsLiveSessionId') or '')
    number = str(settings.get('teamsSessionNumber') or legacy.get('teamsSessionNumber') or '')
    day = str(settings.get('sessionDate') or legacy.get('sessionDate') or '')[:10]
    candidates = list(sessions.values())
    if occurrence:
        candidates = [row for row in candidates if str(row['id']) == occurrence
                      and (not series or str(row['live_session_id']) == series)]
    else:
        if not series and not day:
            return None
        if series:
            candidates = [row for row in candidates if str(row['live_session_id']) == series]
        if number:
            candidates = [row for row in candidates if str(row.get('session_number')) == number]
        if day:
            candidates = [row for row in candidates if row.get('scheduled_start')
                          and aware(row['scheduled_start']).astimezone(UK).date().isoformat() == day]
    return candidates[0] if len(candidates) == 1 else None


def read_attendance(plan, components, module_id, read, table, *, now=None, saved_rows=None):
    activities = [row for row in plan if is_attendance(row)]
    learner_ids = sorted({int(row['learnerId']) for row in activities})
    if not learner_ids:
        return {}
    slots = ','.join(['%s'] * len(learner_ids))
    records = read(f'''SELECT r.learner_profile_id,r.module_catalogue_id,o.id AS occurrence_id,
        o.live_session_id,r.attendance_status,r.attended_seconds,r.first_join_at,r.last_leave_at,
        o.scheduled_start,o.scheduled_end,o.session_number,o.status AS occurrence_status,
        s.status AS session_status
        FROM {table('live_session_occurrences', 'curriculum')} o
        JOIN {table('live_sessions', 'curriculum')} s ON s.id=o.live_session_id
        LEFT JOIN {table('live_session_learner_attendance', 'curriculum')} r
          ON r.occurrence_id=o.id AND r.live_session_id=o.live_session_id
          AND r.module_catalogue_id=%s AND r.learner_profile_id IN ({slots})
        WHERE s.module_catalogue_id=%s OR r.module_catalogue_id=%s''',
        [module_id, *learner_ids, module_id, module_id])
    # A shared delivery may refer to another module's meeting. Only a register
    # row owned by this module can add that occurrence to its scheduled sessions.
    sessions = {}
    by_owner = defaultdict(list)
    for row in records:
        sessions.setdefault(str(row['occurrence_id']), {**row, 'id': row['occurrence_id']})
        if row['learner_profile_id'] is not None:
            by_owner[(str(row['learner_profile_id']), str(row['occurrence_id']))].append(row)
    now = now or timezone.now()
    from learner_api.attendance_otjh import protected_months
    frozen = protected_months(learner_ids, read, table)
    result = {}
    credited = set()
    for activity in activities:
        session = match_session(components.get(activity['componentId'], {}), sessions)
        state = {'status': 'unlinked', 'occurrenceId': None, 'sessionDate': None,
                 'attendedSeconds': None, 'firstJoinAt': None, 'lastLeaveAt': None}
        if session:
            occurrence_id = str(session['id'])
            matches = by_owner[(str(activity['learnerId']), occurrence_id)]
            record = matches[0] if len(matches) == 1 else None
            start, end = aware(session.get('scheduled_start')), aware(session.get('scheduled_end'))
            protected = frozen.get(int(activity['learnerId']), {})
            saved = (saved_rows or {}).get((str(activity['learnerId']), activity['componentId']), [])
            from learner_api.canonical_learning import allocations
            frozen_allocation = any(record.get('reporting_month') in protected
                or any(part.get('reporting_month') in protected for part in allocations(record)) for record in saved)
            state.update(status='unmarked', occurrenceId=occurrence_id,
                         sessionDate=start.astimezone(UK).date().isoformat() if start else None)
            invalid = any(str((record or session).get(key) or '').strip().lower() in INVALID
                          for key in ('occurrence_status', 'session_status'))
            if invalid:
                state['status'] = 'cancelled'
            elif start and start > now:
                state['status'] = 'upcoming'
            elif start and end and start <= now < end:
                state['status'] = 'in_progress'
            elif record and record['attendance_status'] in {'present', 'absent'}:
                state.update(status=record['attendance_status'],
                             attendedSeconds=record.get('attended_seconds'),
                             firstJoinAt=record.get('first_join_at'), lastLeaveAt=record.get('last_leave_at'))
                if (state['status'] == 'present' and start and end and start < end <= now
                        and state['sessionDate'][:7] not in protected and not frozen_allocation):
                    # Two authored activities linked to one lecture must not
                    # award its hours twice. Each learner has their own credit.
                    key = (str(activity['learnerId']), occurrence_id)
                    state['creditedOtjh'] = 0 if key in credited else ATTENDED_SECONDS / 3600
                    credited.add(key)
        result[(str(activity['learnerId']), activity['componentId'])] = state
    return result
