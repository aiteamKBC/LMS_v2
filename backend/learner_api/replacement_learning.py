"""Read-only completion lineage for verified course successors.

The current catalogue owns content and placement. The canonical student-activity
record owns previous completion. Neither attempts, attendance nor hours are
created by this projection.
"""
import json
from collections import Counter

from .subject_origins import read_replacement_courses


def _object(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    return value if isinstance(value, dict) else {}


def project_replacement_learning(components, settings_by_id, courses, activities):
    """Match exact course + material/quiz identity, never names or positions."""
    catalogue = {}
    for activity in activities:
        key = (f"legacy:{activity['group_id']}", activity.get('catalogue_kind'),
               str(activity.get('source_activity_id')))
        catalogue.setdefault(key, []).append(activity)
    candidates = {}
    course_uses = Counter(courses.values())
    for component in components:
        ident = component.get('componentId')
        course = courses.get(f"current:{component.get('moduleId')}")
        if not ident or not course or course_uses[course] != 1 or component.get('retired'):
            continue
        settings = _object(settings_by_id.get(ident))
        legacy = _object(settings.get('legacySettings'))
        source_id = str(legacy.get('sourceLessonId') or '')
        if not source_id.isdigit() or int(source_id) <= 0:
            continue
        kind = 'quiz' if component.get('isQuiz') or component.get('type') == 'quiz' else 'material'
        # sourceMaterialKey disambiguates imported quizzes from companion
        # readings. Contradictory provenance needs review, not title matching.
        material_key = str(legacy.get('sourceMaterialKey') or '')
        if material_key.startswith('quiz-') and (kind != 'quiz' or material_key != f'quiz-{source_id}'):
            continue
        key = (course, kind, str(int(source_id)))
        if len(catalogue.get(key, [])) == 1:
            candidates[ident] = key
    uses = Counter(candidates.values())
    result = []
    for component in components:
        key = candidates.get(component.get('componentId'))
        if key is None or uses[key] != 1:
            result.append(component)
            continue
        activity = catalogue[key][0]
        result.append({**component, 'previousLearning': {
            'courseRef': key[0], 'activityId': activity['activity_id'],
            'sourceActivityId': int(key[2]), 'catalogueKind': key[1],
            'completed': activity.get('completed') is True,
        }})
    return result


def annotate_replacement_learning(components, enrolment_id):
    """Resolve scope from the server's effective plan and owned source courses."""
    from django.db import connections
    from . import canonical_learning

    assigned = sorted({str(c['moduleId']) for c in components if c.get('moduleId') and c.get('componentId')})
    if not assigned:
        return components
    with connections['enrolment'].cursor() as cursor:
        courses = read_replacement_courses(cursor, [{'id': ident} for ident in assigned], enrolment_id)
        if not courses:
            return components
        component_ids = [c['componentId'] for c in components
                         if c.get('componentId') and f"current:{c.get('moduleId')}" in courses]
        cursor.execute('''SELECT id,settings_json FROM curriculum.components
            WHERE id=ANY(%s) AND module_catalogue_id=ANY(%s)''',
            [component_ids, [key.removeprefix('current:') for key in courses]])
        settings = dict(cursor.fetchall())
    # Use the same catalogue exclusions and completion rules as student-activity.
    # Its own membership check remains in force; no route identity from the
    # browser is used to select another learner or course.
    source = canonical_learning.source_subjects(
        enrolment_id, lambda items: {'activities': items}, include_totals=False,
        course_ids=[ref.removeprefix('legacy:') for ref in courses.values()],
    )
    return project_replacement_learning(components, settings, courses, source['activities'])
