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
from .response_cache import cached_learner_read
from . import canonical_learning, journal_sources
from .identity import learner_profile_for_source
from .learner_detail import SOURCE_MODELS
from .projection_performance import measure_projection
from .weekly_learning import _weekly_component
from .learner_detail import _resolve_from_master, _apply_programme_assignment_template
from .submission_visibility import VISIBLE_SUBMISSION_SQL

# programme/cohort/group are placement properties (not columns); load their id
# columns. The names still resolve through the model properties when read.
WEEKLY_SOURCE_FIELDS = ('id', 'aptem_id', 'learner_type', 'username', 'email',
                        'programme_id', 'cohort_id', 'group_id')


def recorded_ksbs(owner, component_ids):
    """Display existing learner activity links without awarding KSB progress."""
    if not component_ids:
        return {}
    from .progress_cache import value
    sql = f'''SELECT DISTINCT
        coalesce(nullif(p.curriculum_component_ref,''),nullif(p.component_ref,'')) AS component_id,
        upper(btrim(k.ksb_code)) AS code
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learner_progress_ksbs k ON k.progress_id=p.id
        WHERE p.learner_id=%s AND p.deleted_at IS NULL
          AND coalesce(nullif(p.curriculum_component_ref,''),nullif(p.component_ref,''))=ANY(%s)
          AND nullif(btrim(k.ksb_code),'') IS NOT NULL AND {canonical_learning._ksb_not_excluded('k')}
        ORDER BY component_id,code'''
    alias = canonical_learning.repository._query_alias.get() or canonical_learning.repository.DB
    records = value(sql, [alias, list(component_ids)], owner['id'],
                    lambda: canonical_learning.query(sql, [owner['id'], component_ids]))
    result = {}
    for row in records:
        result.setdefault(row['component_id'], []).append(row['code'])
    return result


def reflection_ksbs(owner, component_ids):
    """Saved learner choices, separate from authored mappings and achievement."""
    if not component_ids:
        return {}
    records = canonical_learning.query(f'''SELECT activity_id, status, ksb_codes
        FROM "Learner".learning_reflection_submissions AS submission
        WHERE learner_id=%s AND learner_kind=%s AND activity_id=ANY(%s)
          AND {VISIBLE_SUBMISSION_SQL}
        ORDER BY activity_id, status, submitted_at, id''',
        [str(owner['enrolment_id']), owner['learner_type'], component_ids])
    grouped = {}
    for row in records:
        # Keep topic drafts/pending reviews distinct from accepted work.
        codes = canonical_learning.decoded(row['ksb_codes'], [])
        if not isinstance(codes, list):
            continue
        selected = {code.strip() for code in codes if isinstance(code, str) and code.strip()}
        if selected:
            grouped.setdefault(row['activity_id'], {}).setdefault(row['status'], set()).update(selected)
    return {cid: [{'status': status, 'codes': sorted(codes)} for status, codes in groups.items()]
            for cid, groups in grouped.items()}


def slot_id(module_id, slot):
    return f"{'reading' if slot.get('type') == 'reading-week' else 'slot'}:{module_id}:{slot['slotNumber']}"


def _selection(week_id, module_id):
    if week_id is None:
        return None
    # Preserve the Student cache/routing IDs while Coach uses module:slot IDs.
    try:
        parts = week_id.split(':')
        prefix, mid, slot = parts if len(parts) == 3 else ('slot', *parts)
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
                                      module_id=module_id, include_weeks=week_id is None, include_actions=True)
    except LookupError:
        raise ServiceError('Week not found.', 'not_found', 404)
    selected = payload['selectedWeek']
    navigation = next((week for week in payload['weeks'] if selected and week['id'] == selected['weekId']), None)
    if week_id is not None and (navigation is None or slot_id(navigation['moduleId'], {
            'type': navigation['kind'], 'slotNumber': navigation['slotNumber']}) != week_id
            and navigation['id'] != week_id):
        raise ServiceError('Week not found.', 'not_found', 404)
    if selected and selected['activities']:
        # Eligibility and routing remain the Student resolver's responsibility.
        # Only the selected authored week and its saved KSB links are read;
        # no attempt bodies or separate progress/schedule payload cross the wire.
        _, _, components = _resolve_from_master([], [], [],
            assigned_modules=[{'moduleId': navigation['moduleId']}], strict=True, compact=True,
            live_session_ids=False, week_ids=[str(navigation['weekId'])],
            resolved_metadata=getattr(source, '_weekly_resolved_metadata', None), routing_only=True)
        components = _apply_programme_assignment_template(components, source.programme)
        routing = {str(row['componentId']): _weekly_component(row) for row in components}
        activity_ids = [str(activity['id']) for activity in selected['activities']]
        selections = reflection_ksbs(owner, activity_ids)
        recorded = recorded_ksbs(owner, activity_ids)
        for activity in selected['activities']:
            row = routing.get(str(activity['id']))
            if row is None:
                raise ServiceError('Activity routing could not be resolved.', 'invalid_week', 503)
            activity.update({key: row.get(key) for key in (
                'contentAvailable', 'videoUrl', 'sessionDate', 'sessionDateTimeUtc', 'teamsLiveSessionId') if key in row})
            activity['reflectionKsbs'] = selections.get(str(activity['id']), [])
            activity['recordedKsbCodes'] = recorded.get(str(activity['id']), [])
    return payload


@learner_self_or_staff(kwarg='pk')
@require_GET
@journal_sources.learner_journal_view
@cached_learner_read('dashboard-weekly')
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
            response = JsonResponse(payload)
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except (DatabaseError, ValueError):
        return JsonResponse({'error': 'Could not load your weekly plan. Please try again.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response
