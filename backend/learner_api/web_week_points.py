"""Read optional website groups, without loading lessons or calculating progress.

This endpoint only supplies presentation metadata. Existing activity access,
completion and mobile responses are unchanged.
"""
from django.core.exceptions import ObjectDoesNotExist
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff
from old_otjh.service import ServiceError
from curriculum_api.web_week_points import read_configurations
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql


def project_points(rows, configurations):
    weeks = {}
    for cid, wid, mid in rows:
        week = weeks.setdefault(wid, {'moduleId': mid, 'members': set()})
        week['members'].add(cid)
    result = {}
    for wid, week in weeks.items():
        config = configurations.get(wid)
        if not config or config['moduleId'] != week['moduleId']:
            continue
        seen = set()
        points = []
        for point in config['points']:
            members = [cid for cid in point['componentIds'] if cid in week['members'] and cid not in seen]
            seen.update(members)
            points.append({'id': point['id'], 'title': point['title'], 'componentIds': members})
        result[wid] = {'moduleId': week['moduleId'], 'points': points}
    return {'weeks': result}


def learner_plan(kind, learner_id):
    from .learner_detail import SOURCE_MODELS
    from .learning_plan import _effective_plan_ids
    from . import canonical_learning
    from coach_api.weekly_learning import assignment_projection
    model = SOURCE_MODELS.get(kind)
    if model is None:
        raise ValueError('Invalid learner kind.')
    source = assignment_projection(model.all_learners.only(
        'id', 'aptem_id', 'learner_type',
    )).get(pk=learner_id)
    source.training_plan = source._weekly_training_plan
    source.learning_plan = source._weekly_learning_plan
    owner = canonical_learning.require_profile(learner_id)
    module_ids = list(dict.fromkeys([
        *_effective_plan_ids(source, {}), *canonical_learning.curriculum_module_ids_for(owner),
    ]))
    if not module_ids:
        return {'weeks': {}}
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''SELECT c.id, c.week_id, c.module_catalogue_id
            FROM curriculum.components c
            JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND {visible_child_sql('c')}
              AND {visible_week_sql('w')}''', [module_ids])
        rows = cursor.fetchall()
    return project_points(rows, read_configurations({row[1] for row in rows}))


@require_GET
@learner_self_or_staff(kwarg='pk')
def web_points(request, kind, pk):
    try:
        response = JsonResponse(learner_plan(kind, pk))
    except (ObjectDoesNotExist, ValueError):
        response = JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as exc:
        response = JsonResponse({'error': str(exc)}, status=exc.status)
    except DatabaseError:
        response = JsonResponse({'error': 'Could not load Points. Activities remain available; retry to load grouping.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response
