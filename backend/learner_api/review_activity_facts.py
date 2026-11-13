"""Review counts from Dashboard Overview's Activities cards, without writes.

Keep the displayed catalogue and its target population together. In particular,
a historical course already representing a module suppresses its native copy,
just as it does in Dashboard Overview. Historical membership is not completion.
"""
import re

from old_otjh.service import ServiceError

from . import canonical_learning
from .dashboard_overview import overview_subjects
from .dashboard_tabs import learning_projection
from .progress_cutoff import records_as_of
from .retained_quiz_progress import retain_quiz_progress
from .review_required_activities import has_required_hours, required_activity_fact


def _unavailable():
    return ServiceError('The learner\'s live activity population needs review.',
                        'activity_identity_review_required', 409)


def _main_activity(card, component=None):
    """Use catalogue types, never titles, for the coach form's target subset."""
    if component and component.get('isQuiz'):
        return True
    category = re.sub(r'[\s_-]+', '', str(card.get('category') or '').casefold())
    return category in {'reading', 'reading+quiz', 'readingquiz', 'lecture', 'livesession', 'quiz', 'quizzes'}


def overview_activity_facts(learning, *, include_required=True):
    """Count the same cards and completion flags as Overview, once per identity.

    Browser sorting can choose a different display module for a duplicate. It
    cannot change review totals: conflicting completion or schedule identities
    are rejected rather than selecting an arbitrary target by title ordering.
    """
    detail = learning['detail']
    legacy = {(f"legacy:{item['group_id']}", item['activity_id']): item
              for item in (learning.get('activity') or {}).get('activities', [])}
    dates = learning['metadata'].get('activity_dates') or {}
    required = []
    lookup = {}
    retired = {id(c) for c in detail.get('retiredQuizComponents', [])}
    for index, component in enumerate([*detail.get('components', []),
                                       *detail.get('retiredQuizComponents', [])]):
        ref = component.get('componentId') or f"quiz:{(component.get('quizMeta') or {}).get('quizId') or str(component.get('week')) + ':' + str(index)}"
        lookup.setdefault((ref, component.get('moduleId')), []).append(component)
    modules, native, seen = [], [], {}
    historical_count = retained_count = 0
    main = {
        'nativeComponents': [], 'historicalComponents': 0, 'retainedComponents': 0,
        'completedNativeComponents': 0, 'completedHistoricalComponents': 0,
        'completedRetainedComponents': 0,
    }
    for subject in overview_subjects(learning):
        module_id = subject.get('moduleId') or (learning['metadata']['builder_subjects'].get(subject['id']) or {}).get('id') \
            or (subject['id'][8:] if subject['id'].startswith('current:') else None)
        row = {'id': subject['id'], 'title': subject['title'], 'total': 0, 'completed': 0}
        for card in subject['activities']:
            historical = subject['id'].startswith('legacy:')
            candidates = lookup.get((card['id'], module_id), []) if not historical else []
            component = candidates[0] if candidates else None
            if not historical and (not component or not module_id):
                raise _unavailable()
            retained = component is not None and id(component) in retired
            placement = None if historical else (module_id, component.get('weekId'), retained)
            if any((c.get('moduleId'), c.get('weekId'), id(c) in retired) != placement for c in candidates):
                raise _unavailable()
            is_main = _main_activity(card, component)
            if any(_main_activity({'category': c.get('type')}, c) != is_main for c in candidates):
                raise _unavailable()
            if include_required and any(has_required_hours(c.get('expectedOtjh')) != has_required_hours(component.get('expectedOtjh'))
                   for c in candidates):
                raise _unavailable()
            required_fact = required_activity_fact(card, component=component,
                legacy=legacy.get((subject['id'], card['id'])) if historical else None,
                schedule=dates.get(card['id'])) if include_required else None
            signature = (bool(card['completed']), historical, placement, is_main,
                         required_fact is not None, required_fact['dueDate'] if required_fact else None)
            identity = card.get('dedupe')
            if identity and identity in seen:
                if seen[identity] != signature:
                    raise _unavailable()
                continue
            if identity:
                seen[identity] = signature
            if required_fact is not None:
                required.append(required_fact)
            row['total'] += 1
            row['completed'] += bool(card['completed'])
            if historical:
                historical_count += 1
                main['historicalComponents'] += is_main
                main['completedHistoricalComponents'] += is_main and bool(card['completed'])
            elif retained:
                retained_count += 1
                main['retainedComponents'] += is_main
                main['completedRetainedComponents'] += is_main and bool(card['completed'])
            else:
                native.append(component)
                if is_main:
                    main['nativeComponents'].append(component)
                    main['completedNativeComponents'] += bool(card['completed'])
        modules.append(row)
    return {'modules': modules, 'nativeComponents': native,
            'historicalComponents': historical_count, 'retainedComponents': retained_count,
            'mainActivities': main, 'requiredActivities': required}


def dashboard_activity_facts(source, profile, *, as_of, include_required=False, include_record_counts=False):
    owner = canonical_learning.require_profile(source.pk)
    if owner['id'] != profile.pk or owner['enrolment_id'] != source.pk or profile.enrolment_id != source.pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    records = records_as_of(canonical_learning.entries_for(owner, training_summary=True), as_of)
    # Overview's progress reader omits non-quiz timestamps. Supply its same
    # progress buckets with the snapshot cutoff applied BEFORE that projection.
    entries = records_as_of(list(profile.progress_entries.using('enrolment')
        .filter(deleted_at__isnull=True).exclude(kind='activity_event')
        .values('kind', 'passed', 'component_ref', 'quiz_ref', 'submitted_at')), as_of)
    quizzes, videos, components = [], [], []
    for entry in entries:
        item = {'kind': entry['kind'], 'passed': entry['passed'], 'componentId': entry['component_ref']}
        if entry['kind'] == 'quiz':
            quizzes.append({**item, 'quizId': entry['quiz_ref']})
        elif entry['kind'] == 'video':
            videos.append(item)
        elif entry['kind'] == 'component' or (entry['kind'] == 'quiz_reading' and entry['submitted_at']):
            components.append(item)
    learning = learning_projection(source, owner, records, compact_content=True,
                                   progress=(quizzes, videos, components), required_activities=include_required,
                                   include_activity_dates=include_required)
    # Passing progress avoids the unbounded historical-quiz lookup in the
    # shared builder. Resolve only attempts known at this calculation instant.
    retain_quiz_progress(learning['detail'], completed_only=True, strict=True)
    facts = overview_activity_facts(learning, include_required=include_required)
    if include_record_counts:
        facts['completedRecords'] = canonical_learning.metrics_from_records(records, {})['programme']['completed']
    return facts
