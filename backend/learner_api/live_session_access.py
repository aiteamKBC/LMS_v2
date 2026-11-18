"""Recording readiness gates learner-entered time, independently of content access."""
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone

from curriculum_api.learning_storage import read_sql
from curriculum_api.learner_activity_attendance import aware
from curriculum_api.module_attendance_register import match_session
from .attendance_rules import INVALID


MESSAGES = {
    'upcoming': 'Time entry opens after the session ends and its recording is ready to watch.',
    'in_progress': 'The session is in progress. Time entry opens after it ends and its recording is ready to watch.',
    'awaiting_recording': 'Time entry opens when the session recording is ready to watch.',
    'unlinked': 'Time entry is unavailable until the session recording is linked and ready to watch.',
    'cancelled': 'Time entry is unavailable for this session.',
    'ready': '',
}


def is_live(component_type):
    return '_'.join(str(component_type or '').strip().lower().replace('-', ' ').split()) == 'live_session'


def _occurrence(component):
    return component.get('_liveSessionOccurrenceId') or component.get('teamsOccurrenceId')


def _read(sql, params):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(read_sql(sql, cursor.db), params)
        return [dict(zip((column[0] for column in cursor.description), row)) for row in cursor.fetchall()]


def session_access(session, evidence=None, *, now=None):
    """Never infer availability from attendance, saved completion or a join URL."""
    status = 'unlinked'
    if session:
        start, end = aware(session.get('scheduled_start')), aware(session.get('scheduled_end'))
        now = now or timezone.now()
        if any(str(session.get(key) or '').strip().lower() in INVALID
               for key in ('status', 'session_status')):
            status = 'cancelled'
        elif start and start > now:
            status = 'upcoming'
        elif start and end and start <= now < end:
            status = 'in_progress'
        elif start and end and start < end <= now:
            status = 'ready' if (evidence or {}).get('ready') is True else 'awaiting_recording'
    return {'open': status == 'ready', 'status': status, 'message': MESSAGES[status]}


def annotate_access(source, components):
    """Components must already be resolved within this learner's assigned plan."""
    live = [c for c in components if is_live(c.get('type'))]
    if not live:
        return components
    series = sorted({str(c['teamsLiveSessionId']) for c in live if c.get('teamsLiveSessionId')})
    occurrences = sorted({str(_occurrence(c)) for c in live if _occurrence(c)})
    modules = sorted({str(c['moduleId']) for c in live if c.get('moduleId') and c.get('sessionDate')
                      and not c.get('teamsLiveSessionId') and not _occurrence(c)
                      and not c.get('_liveSessionBindingBlocked')})
    sessions = _read('''SELECT o.id,o.live_session_id,o.session_number,o.scheduled_start,
        o.scheduled_end,o.status,s.status AS session_status,s.module_catalogue_id
        FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        WHERE o.live_session_id=ANY(%s) OR o.id=ANY(%s) OR s.module_catalogue_id=ANY(%s)''',
        [series, occurrences, modules]) if series or occurrences or modules else []
    by_id = {str(row['id']): row for row in sessions}
    matched = {}
    for component in live:
        # Older cards resolve by a unique UK session date in their own module,
        # exactly as the full activity reader's schedule fallback does.
        candidates = by_id if component.get('teamsLiveSessionId') or _occurrence(component) else {
            key: row for key, row in by_id.items()
            if str(row.get('module_catalogue_id')) == str(component.get('moduleId'))}
        matched[str(component.get('componentId'))] = None if component.get('_liveSessionBindingBlocked') else (
            match_session({'settings_json': {**component, 'teamsOccurrenceId': _occurrence(component)}}, candidates))
    ended = sorted({str(row['id']) for row in matched.values()
                    if session_access(row)['status'] == 'awaiting_recording'})
    from curriculum_api.recording_views import recording_completion_evidence
    evidence = recording_completion_evidence(
        'commercial' if getattr(source, 'learner_type', '') == 'commercial' else 'apprenticeship',
        source.pk, ended) if ended else {}
    result = []
    for component in components:
        if '_liveSessionBindingBlocked' in component or '_liveSessionOccurrenceId' in component:
            component = {key: value for key, value in component.items()
                         if key not in {'_liveSessionBindingBlocked', '_liveSessionOccurrenceId'}}
        if is_live(component.get('type')):
            session = matched.get(str(component.get('componentId')))
            state = session_access(session, evidence.get(str((session or {}).get('id'))))
            result.append({**component, 'liveSessionAccess': state})
        else:
            result.append(component)
    return result


def access_refusal(kind, learner_id, component_id, *, source=None, component_type=None):
    """Check the authored type, never the type supplied by a completion client."""
    if component_type is not None and not is_live(component_type):
        return None
    try:
        rows = _read('SELECT type,module_catalogue_id FROM curriculum.components WHERE id=%s', [str(component_id)])
        if not rows or not is_live(rows[0]['type']):
            return None  # Other activity types retain their existing validation.
        from .learner_detail import _resolve_from_master
        from .learning_plan import effective_training_plan
        if source is None:
            from .models import CommercialUser, EnrolmentUser
            model = {'commercial': CommercialUser, 'apprenticeship': EnrolmentUser}.get(kind)
            source = model.objects.filter(pk=learner_id).first() if model else None
        if source is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        module_id = str(rows[0]['module_catalogue_id'])
        assigned = [row for row in effective_training_plan(source) if str(row.get('moduleId')) == module_id]
        if not assigned:
            return JsonResponse({'error': 'This activity is not in your learning plan.'}, status=403)
        _, _, components = _resolve_from_master([], [], [], assigned_modules=assigned, strict=True, compact=True)
        component = next((c for c in components if str(c.get('componentId')) == str(component_id)), None)
        if component is None:
            return JsonResponse({'error': 'This activity is not available in your learning plan.'}, status=403)
        access = annotate_access(source, [component])[0]['liveSessionAccess']
        if not access['open']:
            return JsonResponse({'error': access['message'], 'code': 'live_session_locked',
                                 'liveSessionAccess': access}, status=409)
    except DatabaseError:
        return JsonResponse({'error': 'Session recording availability could not be checked. Please try again.',
                             'code': 'live_session_access_unavailable'}, status=503)
    return None
