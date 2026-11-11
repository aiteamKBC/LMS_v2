"""Read-only activity credit from attendance or a recorded-delivery completion.

No progress submission, reflection, KSB achievement or audit ledger is written.
The lecture register owns attendance eligibility and staff corrections.
"""
from collections import defaultdict
from datetime import timezone as utc

from django.db import connections
from django.utils import timezone

from .attendance_rules import attendance_outcome
from .projection_performance import projection_call


# A verified Teams attendance report earns the full Live Teams activity credit.
# This is intentionally separate from the scheduled/session display duration
# used by the attendance register.
LIVE_SESSION_CREDIT_MINUTES = 150


def _live(component):
    return str(component.get('type') or '').strip().lower().replace('-', '_') == 'live_session'


def project_live_credits(components, register, *, now=None):
    now = now or timezone.now()
    components = {str(c['componentId']): c for c in components if c.get('componentId') and _live(c)}
    register_by_module = defaultdict(list)
    for row in register:
        if row.get('source') == 'microsoft-teams':
            register_by_module[row.get('module_catalogue_id')].append(row)
    candidates = defaultdict(list)
    for component_id, component in components.items():
        matches = []
        for row in register_by_module.get(component.get('moduleId'), []):
            occurrence = str(row.get('attendance_source_occurrence_id') or row.get('occurrence_id') or row.get('session_id') or '')
            if component.get('teamsOccurrenceId'):
                matched = str(component['teamsOccurrenceId']) in {occurrence, str(row.get('session_id') or '')}
            elif component.get('teamsLiveSessionId') and component.get('teamsSessionNumber'):
                matched = (component['teamsLiveSessionId'] == row.get('live_session_id')
                           and str(component['teamsSessionNumber']) == str(row.get('session_number')))
            else:
                # Imported/shared cards may only have their authored date.
                # Both directions must be unique; never guess among two sessions.
                matched = (bool(component.get('sessionDate'))
                           and str(component['sessionDate'])[:10] == str(row.get('session_date'))
                           and (not component.get('teamsLiveSessionId')
                                or component['teamsLiveSessionId'] == row.get('live_session_id')))
            if matched:
                matches.append((occurrence, row))
        if len(matches) == 1:
            occurrence, row = matches[0]
            candidates[occurrence].append((component_id, component, row))
    result = []
    for occurrence, matches in candidates.items():
        if not occurrence or len(matches) != 1:
            continue
        component_id, component, row = matches[0]
        status, counted = attendance_outcome(row, now)
        raw = row.get('raw_attendance_status') or row.get('attendance_status')
        seconds = max(0, float(row.get('attended_seconds') or 0))
        if (not counted or status != 'present' or raw != 'present' or not row.get('attendance_report_id')
                or not (seconds > 180 or row.get('attended') is True)):
            continue
        end = row.get('scheduled_end')
        if end is None:
            continue
        if timezone.is_naive(end):
            end = timezone.make_aware(end, utc.utc)
        result.append({'componentId': component_id, 'moduleId': component['moduleId'],
                       'title': component.get('title') or row.get('session_title') or 'Live session',
                       'occurrenceId': occurrence, 'hours': LIVE_SESSION_CREDIT_MINUTES / 60,
                       'verifiedSeconds': seconds, 'submittedAt': end.isoformat()})
    return result


def read_live_credits(source, *, components=None, module_ids=None, register=None):
    from .attendance_lectures import lecture_register
    if components is None:
        module_ids = sorted(set(module_ids or []))
        if not module_ids:
            return []
        from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
        with connections['enrolment'].cursor() as cur:
            cur.execute(f'''SELECT c.id,c.module_catalogue_id,c.title,
                c.settings_json->>'teamsOccurrenceId',c.settings_json->>'teamsLiveSessionId',
                c.settings_json->>'teamsSessionNumber',c.settings_json->>'sessionDate'
                FROM curriculum.components c JOIN curriculum.weeks w ON w.id=c.week_id
                AND w.module_catalogue_id=c.module_catalogue_id
                WHERE c.module_catalogue_id=ANY(%s) AND lower(replace(btrim(c.type),'-','_'))='live_session'
                AND {visible_child_sql('c')} AND {visible_week_sql('w')}
                ORDER BY c.id''', [module_ids])
            components = [dict(zip(('componentId', 'moduleId', 'title', 'teamsOccurrenceId',
                                    'teamsLiveSessionId', 'teamsSessionNumber', 'sessionDate'), row),
                               type='live_session') for row in cur.fetchall()]
    components = list(components)
    scope = sorted({c['moduleId'] for c in components if c.get('moduleId')
                    and str(c.get('type') or '').replace('-', '_') in {'live_session', 'recording_placeholder'}})
    if scope:
        from .recorded_attendance import saved_delivery_mode
        if saved_delivery_mode(getattr(source, 'pk', None) or source.id) == 'lazy':
            from .recorded_session_progress import read_recorded_credits
            return read_recorded_credits(source, scope, register=register)
    live = [c for c in components if _live(c) and c.get('componentId') and c.get('moduleId')]
    if not live:
        return []
    if register is None:
        register = lecture_register(source, module_ids=sorted({c['moduleId'] for c in live}), credit_projection=True)
    verified = projection_call('credit_projection', project_live_credits, live, register)
    states, manual = read_manual_live_credits(source, live)
    # A staff decision replaces the provider credit for the same component;
    # it must not add 2.5 hours on top of the existing two-hour Teams credit.
    return [credit for credit in verified
            if (str(credit['componentId']), str(credit['moduleId'])) not in states] + manual


def read_manual_live_credits(source, components):
    from .models import LearnerProfile
    from .manual_attendance_completion import read_manual_credit_evidence

    enrolment_id = getattr(source, 'pk', None) or getattr(source, 'id', None)
    if enrolment_id is None:
        return {}, []
    profile = getattr(source, '_case_file_profile', None)
    owner = getattr(source, '_canonical_profile', None)
    if (profile is None or str(profile.enrolment_id) != str(enrolment_id)
            or (owner is not None and str(owner['id']) != str(profile.pk))):
        profiles = list(LearnerProfile.objects.filter(enrolment_id=enrolment_id).only('id', 'enrolment_id', 'email')[:2])
        if len(profiles) != 1:
            return {}, []
        profile = profiles[0]
    return read_manual_credit_evidence(components, profile)


def supplement_component_progress(progress, credits):
    from .progress_rules import progress_record_counts_as_achieved
    completed = {str(row.get('componentId')) for row in progress if progress_record_counts_as_achieved(row)}
    credit_by_component = {
        str(credit.get('componentId')): credit
        for credit in credits
        if credit.get('componentId') and float(credit.get('hours') or 0) > 0
    }
    result = []
    for row in progress:
        credit = credit_by_component.get(str(row.get('componentId')))
        # A saved learner completion may still carry the old fixed duration.
        # A verified Teams credit is authoritative for this activity, so
        # project its current 150-minute value without rewriting reflections,
        # KSBs, or the historical source row.
        row_type = str(row.get('componentType') or '').replace('-', '_').replace(' ', '_').lower()
        is_live_credit_row = bool(credit) and (row_type == 'live_session' or (
            not row_type and 'verifiedSeconds' in credit
            and str(credit.get('timeTrackingSource') or 'verified_teams_attendance').startswith('verified_teams')
        ))
        if is_live_credit_row:
            result.append({
                **row,
                'reportedTime': f"{credit['hours'] * 60:g} minutes",
                'timeTaken': None,
                'timeTrackingSource': credit.get('timeTrackingSource', 'verified_teams_attendance'),
                'claimedSeconds': None,
                **({'verifiedSeconds': credit['verifiedSeconds']} if 'verifiedSeconds' in credit else {}),
            })
        else:
            result.append(row)
    for credit in credits:
        if credit['componentId'] in completed:
            continue
        completed.add(credit['componentId'])
        result.append({'kind': 'component', 'componentType': credit.get('componentType', 'live_session'),
                       'componentId': credit['componentId'], 'componentTitle': credit['title'],
                       'startedAt': None, 'submittedAt': credit['submittedAt'], 'timeTaken': None,
                       'timeTrackingSource': credit.get('timeTrackingSource', 'verified_teams_attendance'),
                       'reportedTime': f"{credit['hours'] * 60:g} minutes",
                       **({'verifiedSeconds': credit['verifiedSeconds']} if 'verifiedSeconds' in credit else {}),
                       'ksbs': []})
    return result


def supplement_module_hours(metrics, records, credits):
    """Top up one activity to full lecture credit; preserve stored corrections.

    Existing manual/imported time is already inside the metric. Only the
    remaining credit is added, so manual completion cannot double the hours.
    """
    from . import canonical_learning as canonical
    result = {key: {**value, 'hours': dict(value['hours'])} for key, value in metrics.items()}
    credits = credits if isinstance(credits,(list,tuple)) else list(credits)
    identities = {credit['componentId']: set(credit.get('creditComponentIds') or [credit['componentId']])
                  for credit in credits if credit['moduleId'] in result}
    component_ids = set().union(*identities.values()) if identities else set()
    if not component_ids:
        return result
    seconds_by_component = defaultdict(float)
    corrected = set()
    for record in records:
        component_id = str(record.get('component_ref') or '')
        if component_id not in component_ids:
            continue
        if record.get('actual_basis') == 'staff:module-progress':
            corrected.add(component_id)
        if canonical.counts_as_actual(record):
            seconds_by_component[component_id] += canonical.number(record.get('actual_seconds'))
    seen = set()
    for credit in credits:
        component_id, module_id = credit['componentId'], credit['moduleId']
        if component_id in seen or module_id not in result:
            continue
        seen.add(component_id)
        credit_ids = identities[component_id]
        if credit_ids & corrected:
            continue
        seconds = sum(seconds_by_component[identity] for identity in credit_ids)
        result[module_id]['hours']['actual'] = round(
            result[module_id]['hours']['actual'] + max(0, credit['hours'] - seconds / 3600), 4)
    return result
