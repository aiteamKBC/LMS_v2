"""Student Weekly contract backed by the canonical Coach Weekly reader.

No dashboard aggregates or write-on-read learner-detail repair paths are used.
"""
from types import SimpleNamespace

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff
from old_otjh.service import ServiceError

from coach_api.weekly_learning import assignment_projection, read_weekly_learning
from . import canonical_learning, journal_sources
from .identity import learner_profile_for_source
from .learner_detail import SOURCE_MODELS
from .projection_performance import measure_projection
from .weekly_learning import _weekly_component
from .learner_detail import _resolve_from_master, _apply_programme_assignment_template

WEEKLY_SOURCE_FIELDS = ('id', 'aptem_id', 'learner_type', 'username', 'email', 'programme', 'cohort', 'group')


def learner_attendance(week):
    if week.get('sessionState') == 'upcoming':
        return 'upcoming'
    if week.get('sessionState') in {'cancelled', 'unscheduled'}:
        return 'unmarked'
    return 'present' if week.get('attended') is True else 'absent' if week.get('attended') is False else 'unmarked'


def compact_weekly(payload, *, detail=False):
    """Opt-in v2; legacy Student and Coach wire contracts stay unchanged."""
    def navigation(week):
        return {**{key: value for key, value in week.items()
                   if key not in {'moduleTitle', 'attended', 'activities', 'summary', 'liveSession'}},
                'attendance': learner_attendance(week)}
    modules = {}
    for week in payload.get('weeks', []):
        modules.setdefault(week['moduleId'], {'id': week['moduleId'], 'title': week['moduleTitle']})
    selected = payload.get('selectedWeek')
    result = {'version': 2, 'selectedWeek': None}
    if not detail:
        result.update(modules=list(modules.values()), weeks=[navigation(week) for week in payload['weeks']])
    if selected:
        live = selected['liveSession']
        result['selectedWeek'] = {
            'weekId': selected['id'],
            'summary': {key: value for key, value in selected['summary'].items()
                        if key not in {'completedActivities', 'totalActivities', 'progress'}},
            'liveSession': {**{key: value for key, value in live.items()
                              if key not in {'date', 'startTime', 'endTime', 'attended'}},
                            'attendance': learner_attendance(live)} if live else None,
            'activities': [{key: value for key, value in activity.items()
                            if key not in {'completed', 'sessionDate', 'sessionDateTimeUtc', 'teamsLiveSessionId'}}
                           for activity in selected['activities']],
        }
        if detail:
            result['week'] = navigation(selected)
    return result


def slot_id(module_id, slot):
    return f"{'reading' if slot.get('type') == 'reading-week' else 'slot'}:{module_id}:{slot['slotNumber']}"


def _selection(week_id, module_id):
    if week_id is None:
        return None
    # Preserve the Student cache/routing IDs while Coach uses module:slot IDs.
    try:
        prefix, mid, slot = week_id.split(':')
        if prefix not in {'slot', 'reading'} or not slot.isdigit() or int(slot) < 1 or mid != module_id:
            raise ValueError
    except ValueError:
        raise ServiceError('Week not found.', 'not_found', 404)
    return f'{mid}:{int(slot)}'


def read_dashboard_weekly(source, pk, *, week_id=None, module_id=None):
    owner = canonical_learning.require_profile(pk)
    profile = learner_profile_for_source(source, pk, heal=False, fields=('id', 'enrolment_id'))
    if profile is None or profile.pk != owner['id'] or profile.enrolment_id != pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    source._canonical_profile = owner
    source._case_file_profile = profile
    selection = _selection(week_id, module_id)
    try:
        payload = read_weekly_learning(SimpleNamespace(source=source, profile=profile), selection,
                                      module_id=module_id, include_weeks=week_id is None, include_navigation=True,
                                      student_projection=True)
    except LookupError:
        raise ServiceError('Week not found.', 'not_found', 404)
    selected = payload['selectedWeek']
    if week_id is not None and (selected is None or slot_id(selected['moduleId'], {
            'type': selected['kind'], 'slotNumber': selected['slotNumber']}) != week_id):
        raise ServiceError('Week not found.', 'not_found', 404)
    if selected:
        # Navigator instants are already represented by liveSession in detail.
        selected.pop('sessionStart', None)
        selected.pop('sessionDurationMinutes', None)
    if selected and selected['activities']:
        # Eligibility and routing remain the Student resolver's responsibility.
        # Only the selected authored week is read; no progress is reloaded and
        # no separate component/progress/schedule payload crosses the wire.
        _, _, components = _resolve_from_master([], [], [],
            assigned_modules=[{'moduleId': selected['moduleId']}], strict=True, compact=True,
            live_session_ids=False, week_ids=[str(selected['weekId'])],
            resolved_metadata=getattr(source, '_weekly_resolved_metadata', None), routing_only=True)
        components = _apply_programme_assignment_template(components, source.programme)
        routing = {str(row['componentId']): _weekly_component(row) for row in components}
        for activity in selected['activities']:
            row = routing.get(str(activity['id']))
            if row is None:
                raise ServiceError('Activity routing could not be resolved.', 'invalid_week', 503)
            activity.update({key: row.get(key) for key in (
                'contentAvailable', 'videoUrl', 'sessionDate', 'sessionDateTimeUtc', 'teamsLiveSessionId') if key in row})
    return payload if week_id is None else {'selectedWeek': selected}


@require_GET
@learner_self_or_staff(kwarg='pk')
@journal_sources.learner_journal_view
def dashboard_weekly(request, kind, pk, week_id=None):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    try:
        with measure_projection('dashboard-week-detail' if week_id else 'dashboard-weekly', kind=kind, learner_id=pk):
            source = assignment_projection(model.all_learners.only(*WEEKLY_SOURCE_FIELDS)).get(pk=pk)
            source.training_plan = source._weekly_training_plan
            source.learning_plan = source._weekly_learning_plan
            payload = read_dashboard_weekly(source, pk, week_id=week_id, module_id=request.GET.get('moduleId'))
            if request.GET.get('version') == '2':
                payload = compact_weekly(payload, detail=week_id is not None)
            response = JsonResponse(payload)
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except (DatabaseError, ValueError):
        return JsonResponse({'error': 'Could not load your weekly plan. Please try again.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response
