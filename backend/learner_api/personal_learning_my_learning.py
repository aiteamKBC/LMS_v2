"""My Learning reads for a personal course: one module, no learner record.

The learner catalogue, subject, search and upcoming endpoints read a real
learner's plan, ledger and previous learning. A personal course has none of
those -- only its own module and, in study mode, its isolated saved progress.
Cards still go through the learner assembly so their status, next activity and
counts follow the rules learners see. Read-only: nothing here writes.
"""
import re
from urllib.parse import unquote

from django.db import connections


def prefix(identity):
    return f'/learner_api/my-learning/commercial/{identity}/'


def native_learning(detail):
    # The learner assembly mutates its input; give it a copy of only the
    # buckets it reads.
    native = {key: list(detail.get(key) or []) for key in ('components', 'quizAttempts', 'videoProgress', 'componentProgress')}
    native.update(modules=list(detail.get('modules') or []), retiredQuizComponents=[])
    return native


def cards_for(context, detail, module, *, search=None):
    from .my_learning import assemble_cards, catalogue_module_rows
    from .personal_learning import metadata as course_metadata
    found = course_metadata(detail, module)
    modules = {}
    if search is None:
        with connections['enrolment'].cursor() as cursor:
            modules = catalogue_module_rows(cursor, [context['module_id']], identity_metadata={})
    # No previous learning, imports, replacements or transfers in a personal course.
    metadata = dict(found, imported_courses={}, replacement_courses={}, previous_learning_groups={},
        replacement_settings={}, record_ids=set(), modules=modules, progress_transfers=[])
    cards, summary = assemble_cards(native_learning(detail), found['current_subjects'], [], [], set(), set(), {},
        metadata, [], modules, [], search=search)
    return cards, summary, found


def catalogue(context, detail, module):
    cards, summary, found = cards_for(context, detail, module)
    for card in cards:
        card['cover'] = found['covers'].get(card['id']) or None
        # Personal study is outside official study hours.
        card['actualHours'] = None
        if card['source'] == 'current':
            card.pop('moduleId', None)
    return {'learner': {'id': context['id'], 'kind': 'commercial', 'name': detail.get('name') or '',
                        'programme': detail.get('programme') or '', 'cohort': detail.get('cohort') or '', 'group': detail.get('group') or ''},
            'summary': summary, 'modules': cards, 'otjh': {'actual': None, 'planned': None},
            # Upcoming links are live sessions and deadlines, neither of which a personal course has.
            'upcoming': [], 'hasMoreUpcoming': False}


def subject(context, detail, module, subject_id):
    from .personal_learning import metadata as course_metadata
    from .personal_learning_policy import component_for
    from .personal_learning_reads import learning_schedule
    mid = context['module_id']
    if subject_id.startswith('activity:'):
        component_for(detail, subject_id[9:])
    elif subject_id not in (mid, f'current:{mid}'):
        raise LookupError("Module not found in this learner's plan.")
    found = course_metadata(detail, module)
    component_ids = {c.get('componentId') for c in detail['components'] if c.get('componentId')}
    selected = dict(detail, retiredQuizComponents=[],
        modules=list(dict.fromkeys(c.get('module') for c in detail['components'] if c.get('module'))))
    return {'subjectId': f'current:{mid}', 'detail': selected, 'activity': None,
            'metadata': {'covers': found['covers'], 'builder_subjects': found['builder_subjects'],
                         'current_subjects': found['current_subjects'], 'imported_courses': {}, 'replacement_courses': {},
                         'previous_learning_groups': {},
                         'activity_dates': {key: value for key, value in found['activity_dates'].items() if key in component_ids}},
            'schedule': learning_schedule(context), 'sessions': []}


def search(context, detail, module, query):
    term = str(query.get('q') or '').strip()
    try:
        offset = int(query.get('offset') or 0)
    except ValueError:
        raise ValueError('Invalid search offset.') from None
    if len(term) > 200 or offset < 0:
        raise ValueError('Invalid search.')
    if not term:
        return {'matches': [], 'nextOffset': None}
    cards, _, _ = cards_for(context, detail, module, search=term.lower())
    matches = [{'id': card['id']} for card in cards if card['_matches']]
    return {'matches': matches[offset:offset + 50], 'nextOffset': offset + 50 if len(matches) > offset + 50 else None}


def my_learning_read(context, detail, module, path, query):
    """Payload for a My Learning GET, or None when the path is not one."""
    root = prefix(context['id'])
    if not path.startswith(root):
        return None
    rest = path[len(root):]
    if rest == '':
        return catalogue(context, detail, module)
    if rest == 'search/':
        return search(context, detail, module, query)
    if rest == 'upcoming/':
        return {'upcoming': []}
    match = re.fullmatch(r'modules/(.+)/', rest)
    if match:
        return subject(context, detail, module, unquote(match[1]))
    return None
