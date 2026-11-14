"""Recorded delivery: one owned activity, completed by live or recorded evidence.

Projection only. Source attendance, submissions and historical hours are never
rewritten. A linked recording earns its authored hours only once it is ready.
"""
from datetime import datetime, timezone as utc
from math import isfinite

from django.db import connections
from django.utils import timezone

from .attendance_rules import INVALID, attendance_outcome


def read_components(module_ids):
    from curriculum_api.schema_compat import active_condition
    from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''SELECT c.id,c.module_catalogue_id,c.title,c.type,
                c.expected_otjh,c.settings_json
            FROM curriculum.components c
            JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s)
              AND lower(replace(btrim(c.type),'-','_')) IN ('live_session','recording_placeholder')
              AND {visible_child_sql('c')} AND {visible_week_sql('w')}
              AND {active_condition('m')}
            ORDER BY c.id''', [list(module_ids)])
        rows = cursor.fetchall()
    import json
    result = []
    for cid, mid, title, kind, hours, settings in rows:
        settings = json.loads(settings) if isinstance(settings, str) else settings
        settings = settings if isinstance(settings, dict) else {}
        result.append({**settings, 'componentId': str(cid), 'moduleId': str(mid),
                       'title': title, 'type': kind, 'expectedOtjh': hours})
    return result


def _type(component):
    return str(component.get('type') or '').strip().lower().replace('-', '_')


def _occurrence(row):
    return str(row.get('attendance_source_occurrence_id') or row.get('occurrence_id') or row.get('session_id') or '')


def _matches(component, row):
    if row.get('source') != 'microsoft-teams' or row.get('module_catalogue_id') != component['moduleId']:
        return False
    if component.get('teamsOccurrenceId'):
        return str(component['teamsOccurrenceId']) in {_occurrence(row), str(row.get('session_id') or '')}
    if component.get('teamsLiveSessionId') and component.get('teamsSessionNumber'):
        return (component['teamsLiveSessionId'] == row.get('live_session_id')
                and str(component['teamsSessionNumber']) == str(row.get('session_number')))
    return (bool(component.get('sessionDate')) and str(component['sessionDate'])[:10] == str(row.get('session_date'))
            and (not component.get('teamsLiveSessionId') or component['teamsLiveSessionId'] == row.get('live_session_id')))


def _instant(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return timezone.make_aware(value, utc.utc) if value and timezone.is_naive(value) else value


def project_recorded_credits(components, register, evidence, live_credits, *, states=None, merge=False, now=None):
    now = now or timezone.now()
    states = states or {}
    live = {c['componentId']: c for c in components if _type(c) == 'live_session'}
    linked = {}
    for component in components:
        if _type(component) != 'recording_placeholder':
            continue
        parent = live.get(component.get('linkedLiveSessionComponentId'))
        parent_module = component.get('linkedLiveSessionModuleId') or component['moduleId']
        # A recording from another module is playable, but never inherits this
        # learner's attendance from a different group or a same-named session.
        if parent and parent_module == parent['moduleId'] == component['moduleId']:
            linked.setdefault(parent['componentId'], []).append(component)
    by_live = {credit['componentId']: credit for credit in live_credits}
    matched = {}
    for component in live.values():
        rows = [row for row in register if _matches(component, row)]
        if len(rows) == 1:
            matched.setdefault(_occurrence(rows[0]), []).append((component, rows[0]))
    credits = []
    for occurrence, matches in matched.items():
        if not occurrence or len(matches) != 1:
            continue
        component, row = matches[0]
        recordings = linked.get(component['componentId'], [])
        if len(recordings) > 1:
            continue
        target = recordings[0] if recordings else component
        target_id = component['componentId'] if merge and recordings else target['componentId']
        decision = states.get((component['componentId'], component['moduleId']))
        if decision is not None and not decision[0]:
            continue
        status, _ = attendance_outcome(row, now)
        if status in {'upcoming', 'in_progress'} or any(
            str(row.get(key) or '').strip().lower() in INVALID
            for key in ('status', 'session_status', 'occurrence_status', 'attendance_status')
        ):
            continue
        recording = evidence.get(occurrence) or {}
        attended = by_live.get(component['componentId'])
        if not recording.get('ready') or not (attended or recording.get('completed')):
            continue
        try:
            hours = float(target.get('expectedOtjh') or 0)
        except (TypeError, ValueError, OverflowError):
            continue
        if not isfinite(hours) or hours < 0:
            continue
        instants = [_instant(value) for value in (
            recording.get('availableAt'),
            attended.get('submittedAt') if attended else recording.get('completedAt'),
            row.get('scheduled_end'),
        ) if value]
        if not instants or max(instants) > now:
            continue
        credits.append({'componentId': target_id, 'moduleId': target['moduleId'],
            'componentType': 'live_session' if target_id == component['componentId'] else target['type'],
            'title': target.get('title') or 'Session recording', 'occurrenceId': occurrence,
            'hours': hours, 'submittedAt': max(instants).isoformat(),
            'timeTrackingSource': (attended or {}).get('timeTrackingSource',
                'verified_teams_attendance' if attended else 'verified_recording_watch'),
            # Historical time may already be stored against either card. Both
            # are the same earned session, not an additional allocation.
            'creditComponentIds': list(dict.fromkeys([component['componentId'], target['componentId']])),
            **({'verifiedSeconds': attended['verifiedSeconds']} if attended and 'verifiedSeconds' in attended else {}),
        })
        if target_id != component['componentId']:
            # Both cards represent this one lecture for Recorded delivery.
            # Close the live card too so watching its recording cannot leave
            # module progress at 50%; all earned hours stay on the recording.
            credits.append({**credits[-1], 'componentId': component['componentId'],
                            'componentType': 'live_session', 'title': component.get('title') or 'Live session',
                            'hours': 0})
    return credits


def read_recorded_credits(source, module_ids, *, register=None):
    from curriculum_api.recording_views import recording_completion_evidence
    from .attendance_lectures import lecture_register
    from .linked_recordings import merge_enabled
    from .live_session_progress import project_live_credits, read_manual_live_credits

    components = read_components(module_ids)
    if not components:
        return []
    if register is None:
        register = lecture_register(source, module_ids=list(module_ids), credit_projection=True)
    live = [c for c in components if _type(c) == 'live_session']
    states, manual = read_manual_live_credits(source, live)
    verified = [credit for credit in project_live_credits(live, register)
                if (credit['componentId'], credit['moduleId']) not in states] + manual
    occurrence_ids = {_occurrence(row) for row in register if row.get('source') == 'microsoft-teams'} - {''}
    kind = 'commercial' if getattr(source, 'learner_type', '') == 'commercial' else 'apprenticeship'
    evidence = recording_completion_evidence(kind, source.pk if hasattr(source, 'pk') else source.id, occurrence_ids)
    return project_recorded_credits(components, register, evidence, verified, states=states, merge=merge_enabled())
