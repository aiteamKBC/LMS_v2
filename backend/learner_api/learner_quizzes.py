"""Read-only quiz catalogue; no learner hours, attendance or answer payloads."""
from django.db import connections

from .identity import learner_profile_for_source
from .learning_plan import effective_training_plan, request_preset_cache
from .mappers import _s, flatten_training_plan, get_training_plan
from .retained_quiz_progress import retain_quiz_progress
from .weekly_learning import _progress


def retain_imported_quiz_progress(detail, profile):
    """Resolve typed old quiz refs through owned, exact import lineage only.

    Successor courses need their approved transfer workflow. An original import
    already identifies the same activity; its historical attempt stays intact.
    """
    components = {c['componentId']: c for c in detail['components']
                  if c.get('isQuiz') and c.get('componentId') and c.get('moduleId')}
    attempts = [a for a in detail['quizAttempts']
                if a.get('passed') is True and str(a.get('quizId') or '').startswith('quiz:')
                and a.get('componentId') == a.get('quizId')]
    if profile is None or not components or not attempts:
        return
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT DISTINCT s.source_activity_id,slot.id,slot.module_catalogue_id
            FROM "Learner".learner_activity_sources s
            JOIN "Learner".learner_progress_entries p
              ON p.id=s.canonical_progress_id AND p.learner_id=s.learner_id
            JOIN curriculum.source_activities a ON a.id=s.source_catalog_activity_id
              AND a.source_system=s.source_system AND a.source_activity_id=s.source_activity_id
            JOIN curriculum.source_courses c ON c.id=a.source_course_id
              AND c.source_system=s.source_system AND c.source_course_ref=s.source_course_ref
            JOIN "Learner".learner_source_course_memberships membership
              ON membership.source_course_id=c.id AND membership.learner_id=s.learner_id
            JOIN curriculum.components slot ON slot.id=a.curriculum_component_ref AND slot.type='quiz'
            JOIN curriculum.modules module ON module.module_catalogue_id=slot.module_catalogue_id
              AND module.module_catalogue_id=c.curriculum_module_ref
              AND module.source_type='mba-legacy' AND module.source_id=c.source_course_ref
            WHERE s.learner_id=%s AND s.source_system='old_lms' AND s.completed IS TRUE
              AND p.source_system='old_lms' AND p.kind='quiz' AND p.passed IS TRUE
              AND p.quiz_ref=s.source_activity_id AND p.component_ref=s.source_activity_id
              AND a.source_activity_kind='quiz'
              AND s.deleted_at IS NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL
              AND c.deleted_at IS NULL AND membership.deleted_at IS NULL
              AND slot.id=ANY(%s) AND s.source_activity_id=ANY(%s)''',
            [profile.id, sorted(components), sorted({a['quizId'] for a in attempts})])
        slots = {}
        for ref, component_id, module_id in cursor.fetchall():
            if component_id in components and components[component_id]['moduleId'] == module_id:
                slots.setdefault(ref, set()).add(component_id)
    for attempt in attempts:
        candidates = slots.get(attempt['quizId'], set())
        if len(candidates) == 1:
            attempt['componentId'] = next(iter(candidates))


def read_quiz_list(source, pk):
    from .learner_detail import _append_week_quizzes, _resolve_from_master

    assigned = effective_training_plan(source, request_preset_cache(source))
    # Native rows are rebuilt from published master content. Only id-less
    # historical snapshots need flattening; their quizzes must remain visible.
    snapshots = [item for item in get_training_plan(source)
                 if isinstance(item, dict) and not item.get('moduleId')]
    modules, weeks, components = flatten_training_plan(snapshots)
    modules, weeks, components = _resolve_from_master(
        modules, weeks, components, assigned_modules=assigned, compact=True,
        strict=True, identities_only=True, catalogue_facts=True,
        live_session_ids=False, expected_otjh=False)
    weeks, components = _append_week_quizzes(
        weeks, components, assigned_modules=assigned, strict=True, native_week_ids=True)
    profile = learner_profile_for_source(source, pk, heal=False, fields=('id', 'enrolment_id'))
    attempts, _, _ = _progress(profile, active_only=True)
    detail = {'components': components, 'quizAttempts': attempts}
    retain_imported_quiz_progress(detail, profile)
    # Keep the existing summary's re-linked quiz credit, scoped to this plan.
    retain_quiz_progress(detail, completed_only=True, strict=True)
    return {
        'id': str(source.pk), 'name': _s(source.username),
        'programme': _s(source.programme), 'cohort': _s(source.cohort),
        'components': [{
            **{key: component.get(key) for key in (
                'module', 'week', 'component', 'moduleId', 'weekId', 'componentId', 'isQuiz')},
            'expectedOtjh': None,
            'quizMeta': {key: (component.get('quizMeta') or {}).get(key)
                         for key in ('quizId', 'questions', 'duration', 'timeUnit')},
        } for component in components if component.get('isQuiz')],
        'quizAttempts': attempts,
    }
