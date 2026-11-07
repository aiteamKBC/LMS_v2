"""Canonical module progress for Student and the compact Coach projection.

Reads only: deliberately avoids learner-detail's plan/identity repair writes.
Historical allocation remains in canonical_learning.recorded_course_items;
native publication and retained-quiz rules remain in the existing plan readers.
"""
from math import floor

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff

from .journal_sources import learner_journal_view
from .progress_rules import progress_counts_as_achieved
from old_otjh.service import ServiceError


def read_native_progress(source, profile, *, as_of=None):
    # Do not call build_learner_detail: its activation/plan/hour repairs write.
    # Reuse its authored component and retained-quiz projections directly.
    from .learner_detail import (_resolve_from_master, _append_week_quizzes,
                                 _apply_programme_assignment_template)
    from .learning_plan import effective_training_plan
    from .mappers import flatten_training_plan, get_training_plan
    from .retained_quiz_progress import retain_quiz_progress
    from .student_activity import _effective_current_subjects, _builder_subject_metadata
    from django.db import connections

    assigned = effective_training_plan(source)
    modules, weeks, components = flatten_training_plan(get_training_plan(source))
    modules, weeks, components = _resolve_from_master(
        modules, weeks, components, assigned_modules=assigned, compact=True)
    components = _apply_programme_assignment_template(components, getattr(source, 'programme', ''))
    weeks, components = _append_week_quizzes(weeks, components, assigned_modules=assigned)
    from .teams_attendance import annotate_attendance_completion
    components = annotate_attendance_completion(components, profile)
    progress = list(profile.progress_entries.using('enrolment').filter(deleted_at__isnull=True)
                    .exclude(kind='activity_event')
                    .values('kind', 'passed', 'component_ref', 'quiz_ref', 'submitted_at'))
    if as_of is not None:
        from .progress_cutoff import records_as_of
        progress = records_as_of(progress, as_of)
    detail = {'components': components, 'quizAttempts': [
        {'quizId': row['quiz_ref'], 'componentId': row['component_ref'], 'passed': row['passed']}
        for row in progress if row['kind'] == 'quiz']}
    retain_quiz_progress(detail)
    with connections['enrolment'].cursor() as cur:
        current = _effective_current_subjects(cur, source.pk)
        refs = list(dict.fromkeys([f"current:{row['id']}" for row in current] +
                    [f"current:{row['moduleId']}" for row in components if row.get('moduleId')]))
        _, titles = _builder_subject_metadata(cur, refs)
    return detail, current, progress, titles


def _module_progress_facts(activity, detail, current, progress, titles=None):
    """Keep counts and their exact deduplicated target population together."""
    activity = activity or {}
    titles = titles or {}
    historical = {f"legacy:{row['id']}": {'id': f"legacy:{row['id']}",
                  'title': row['name'], 'total': 0, 'completed': 0}
                  for row in activity.get('subjects', [])}
    subjects = {f"current:{row['id']}": {'id': f"current:{row['id']}",
                'title': row['title'], 'total': 0, 'completed': 0} for row in current}
    subjects.update(historical)
    seen_history = set()
    for item in activity.get('activities', []):
        key = f"legacy:{item['group_id']}"
        identity = (key, item['activity_id'])
        if identity in seen_history:
            continue
        seen_history.add(identity)
        subject = subjects.setdefault(key, {'id': key, 'title': item.get('group_name') or 'Unnamed subject',
                                            'total': 0, 'completed': 0})
        subject['total'] += 1
        subject['completed'] += bool(item['completed'])
    completed = {str(row['component_ref']) for row in progress
                 if (row['kind'] in ('component', 'video')
                     or (row['kind'] == 'quiz_reading' and row.get('submitted_at')))
                 and row.get('component_ref')
                 and progress_counts_as_achieved(row['kind'], row['passed'])}
    cards = {}
    for index, item in enumerate([*detail['components'], *detail.get('retiredQuizComponents', [])]):
        module_id = item.get('moduleId')
        if not module_id:
            raise ServiceError('Module progress requires a verified module identity.',
                               'module_identity_review_required', 409)
        key = f'current:{module_id}'
        subjects.setdefault(key, {'id': key, 'title': item.get('module') or 'Unnamed subject',
                                  'total': 0, 'completed': 0})
        component_id = item.get('componentId')
        quiz_id = (item.get('quizMeta') or {}).get('quizId')
        card_id = component_id or f"quiz:{quiz_id if quiz_id is not None else str(item.get('week')) + ':' + str(index)}"
        cards.setdefault(key, {}).setdefault(card_id, item)
    for row in subjects.values():
        row['title'] = titles.get(row['id'], {}).get('title') or row['title']
    seen = set()
    native_components, retained_components = [], []
    retired = {id(item) for item in detail.get('retiredQuizComponents', [])}
    for subject in sorted(subjects.values(), key=lambda row: (row['title'].casefold(), row['id'])):
        for item in cards.get(subject['id'], {}).values():
            component_id = item.get('componentId')
            quiz_id = (item.get('quizMeta') or {}).get('quizId')
            identity = ('component', str(component_id)) if component_id else ('quiz', str(quiz_id)) if quiz_id else None
            if identity and identity in seen:
                continue
            if identity:
                seen.add(identity)
            (retained_components if id(item) in retired else native_components).append(item)
            if item.get('isQuiz'):
                done = bool(item.get('quizMeta')) and any(
                    attempt.get('passed') is True and (
                        (bool(attempt.get('componentId')) and bool(component_id)
                         and str(attempt.get('componentId')) == str(component_id))
                        or (not attempt.get('componentId') and quiz_id is not None
                            and str(attempt.get('quizId')) == str(quiz_id)))
                    for attempt in detail['quizAttempts'])
            else:
                done = item.get('attendanceCompleted') is True or (bool(component_id) and str(component_id) in completed)
            subject['total'] += 1
            subject['completed'] += bool(done)
    modules = [{**row, 'percent': min(100, floor(row['completed'] / row['total'] * 10000 + 0.5) / 100)
             if row['total'] else None}
            for row in sorted(subjects.values(), key=lambda row: (row['title'].casefold(), row['id']))]
    return {'modules': modules, 'nativeComponents': native_components,
            'historicalComponents': sum(row['total'] for row in modules if row['id'].startswith('legacy:')),
            'retainedComponents': len(retained_components)}


def _reusable_register(source, components, register, register_module_ids):
    """The caller's lecture register when it provably serves these components.

    Reuse only a register built for this enrolment whose module scope covers
    every live component credited below. Otherwise return None, and
    read_live_credits builds its own register exactly as before.
    """
    if register is None or register_module_ids is None:
        return None
    from .live_session_progress import _live
    scope = {str(value).strip() for value in register_module_ids if str(value or '').strip()}
    needed = {str(c['moduleId']).strip() for c in components
              if _live(c) and c.get('componentId') and c.get('moduleId')}
    if not needed <= scope:
        return None
    enrolment_id = str(getattr(source, 'pk', None))
    if any('learner_id' in row and str(row['learner_id']) != enrolment_id for row in register):
        return None
    return register


def canonical_module_progress(source, profile, *, read_projection=None, register=None, register_module_ids=None):
    """The single final calculation called by both HTTP consumers.

    ``register`` is an already-built ``lecture_register`` for this ``source``,
    and ``register_module_ids`` the module scope it was built for. Both are
    optional; a register that does not cover the live components is ignored.
    """
    from . import canonical_learning
    from . import journal_sources
    from .student_activity_access import student_activity_available
    from .student_activity_data import summarize_activities

    owner = canonical_learning.require_profile(source.pk)
    if owner['id'] != profile.pk or profile.enrolment_id != source.pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    # Module progress always uses the Student journal perspective. Restore the
    # caller's context before returning; Coach's whole-programme metrics retain
    # their existing perspective in their independent reader.
    token = journal_sources._current.set(True)
    try:
        if read_projection is not None:
            # Coach list projections already own narrow catalogue/native facts.
            # Keep identity, perspective and the final calculation here rather
            # than hydrating learner content a second time for its percentage.
            activity, detail, current, progress, titles = read_projection()
        else:
            records = None
            if as_of is not None:
                from .progress_cutoff import records_as_of
                records = records_as_of(canonical_learning.entries_for(owner, lineage_only=True), as_of)
            activity = canonical_learning.source_subjects(
                source.pk, summarize_activities, owner=owner,
                **({'records': records} if as_of is not None else {}),
            ) if student_activity_available(source.aptem_id) else None
    finally:
        journal_sources._current.reset(token)
    if read_projection is None:
        detail, current, progress, titles = read_native_progress(
            source, profile, **({'as_of': as_of} if as_of is not None else {}),
        )
    from .live_session_progress import read_live_credits
    reusable = _reusable_register(source, detail['components'], register, register_module_ids)
    from .projection_performance import projection_operation
    # Local trace only: records whether the caller's register was reused (P1).
    with projection_operation('module_credits_register_reused' if reusable is not None
                              else 'module_credits_register_built'):
        credits = read_live_credits(source, components=detail['components'],
                                    **({'register': reusable} if reusable is not None else {}))
    progress = [*progress, *({'kind': 'component', 'passed': None,
                            'component_ref': row['componentId'], 'submitted_at': row['submittedAt']}
                           for row in credits)]
    return _module_progress_facts(activity, detail, current, progress, titles)


def canonical_module_progress(source, profile, *, read_projection=None):
    """Keep the existing Dashboard/Coach response and counting rule unchanged."""
    return canonical_module_facts(source, profile, read_projection=read_projection)['modules']


def compact_module_progress(rows):
    return [{key: row[key] for key in ('id', 'title', 'percent')} for row in rows]


# Keep this endpoint separate: no existing Student response contract changes.
@require_GET
@learner_self_or_staff(kwarg='pk')
@learner_journal_view
def learner_module_progress(request, kind, pk):
    from .learner_detail import SOURCE_MODELS
    from .models import LearnerProfile

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        source = model.all_learners.get(pk=pk)
        profile = LearnerProfile.objects.using('enrolment').get(enrolment_id=pk)
        response = JsonResponse({'modules': canonical_module_progress(source, profile)})
        response['Cache-Control'] = 'private, no-store'
        return response
    except (model.DoesNotExist, LearnerProfile.DoesNotExist):
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except DatabaseError:
        return JsonResponse({'error': 'Could not load module progress. Please retry.'}, status=503)
