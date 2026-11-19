"""Count completed course activities for certificates, independently of OTJ hours."""
from math import floor


def course_progress(source, module_ref):
    if module_ref.startswith('free:'):
        return free_course_progress(source, module_ref)

    from . import canonical_learning as canonical
    from .my_learning import load_context, assemble_cards

    owner = canonical.require_profile(source.pk)
    _, _, records, native, courses, definitions, done, started, hours, metadata, credits = load_context(source, owner)
    cards, _ = assemble_cards(
        native, metadata['current_subjects'], courses, definitions, done, started,
        hours, metadata, records, metadata['modules'], credits,
        show_current_replacements=True, include_activity_items=True,
    )
    # Use the unfiltered cards: assigned Builder free courses share this
    # projection but are hidden from the ordinary My courses list.
    card = next((card for card in cards if card['id'] == module_ref), None)
    if card is None:
        raise ValueError("Module not found in this learner's plan.")
    # These scoped, deduplicated items precede saved transfer-summary overrides.
    # A historical percentage or activity-count snapshot must not award credit.
    activities = card['_activityItems']
    total, done = len(activities), sum(bool(item['completed']) for item in activities)
    return {
        'moduleRef': module_ref, 'moduleTitle': card['title'],
        'progressPercent': floor(done / total * 10000 + 0.5) / 100 if total else 0,
        'trackableTotal': total, 'trackableDone': done,
        'finalTestPassed': card.get('finalTestPassed', False),
        'demoProgress': bool(card.get('demoProgress')),
    }


def free_course_progress(source, module_ref):
    from .free_courses_view import _scoped_rows, _activity, free_programme_component_response, _completed_refs
    from .free_course_selectors import canonical_learner, assigned_course_ids

    course_id = module_ref.split(':', 1)[1]
    kind = 'commercial' if source.learner_type == 'commercial' else 'apprenticeship'
    owner = canonical_learner(kind, source.pk)
    if course_id not in assigned_course_ids(owner):
        raise ValueError("Course not found in this learner's assignments.")
    courses, weeks, components = _scoped_rows([course_id])
    if course_id not in courses:
        raise ValueError("Course is no longer available.")
    week_ids = {str(week['id']) for week in weeks if str(week.get('course_id')) == course_id}
    completed = {component for _, component in _completed_refs(owner.pk, [course_id])}
    activities = {}
    for component in components:
        if str(component.get('free_module_id')) not in week_ids:
            continue
        activity = _activity(free_programme_component_response(component))
        # Match FreeCoursesTab.hasContent: empty placeholders do not contribute
        # to its denominator, and a quiz needs a linked quiz definition.
        has_content = bool(activity['quizId']) if 'quiz' in activity['type'].lower() else any(
            activity.get(key) for key in ('videoUrl', 'audioUrl', 'contentHtml', 'resourceUrl')
        )
        if has_content:
            activities[activity['componentId']] = activity
    total = len(activities)
    done = sum(ref in completed for ref in activities)
    return {
        'moduleRef': module_ref,
        'moduleTitle': (courses.get(course_id) or {}).get('course_name') or 'Free course',
        'progressPercent': floor(done / total * 10000 + 0.5) / 100 if total else 0,
        'trackableTotal': total, 'trackableDone': done, 'finalTestPassed': False,
    }
