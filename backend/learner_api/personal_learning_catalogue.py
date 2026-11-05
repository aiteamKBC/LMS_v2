"""Compact My Learning reads for an already-authorized personal course.

No learner identity, enrolment, progress write or live participation is created.
The owning gateway supplies the same personal detail used by activity readers.
"""
import re


def catalogue_request(context, detail, module, path, query):
    from .personal_learning import metadata, progress
    from .personal_learning_policy import component_for
    from .personal_learning_reads import learning_schedule

    base = f'/learner_api/my-learning/commercial/{context["id"]}/'
    if not path.startswith(base):
        return None
    route = path[len(base):]
    subject = 'current:' + context['module_id']
    selected = re.fullmatch(r'modules/([^/]+)/', route)
    if selected:
        requested = selected[1]
        if requested.startswith('activity:'):
            component_for(detail, requested[len('activity:'):])
        elif requested not in (subject, context['module_id']):
            raise LookupError('Module not found in this personal course.')
        # These existing adapters retain date/access rules and saved personal
        # progress. Personal study has no official attendance or live roster.
        return {'subjectId': subject, 'detail': detail, 'activity': None,
                'metadata': metadata(detail, module), 'schedule': learning_schedule(context), 'sessions': []}
    if route == 'search/':
        term = str(query.get('q') or '').strip()
        try:
            offset = int(query.get('offset', 0))
        except (ValueError, TypeError):
            raise ValueError('Invalid search offset.') from None
        if len(term) > 200 or offset < 0:
            raise ValueError('Invalid search.')
        titles = [module.get('title') or '', *(row.get('component') or row.get('componentTitle') or ''
                   for row in detail['components'])]
        found = term and any(term.casefold() in str(title).casefold() for title in titles)
        return {'matches': [{'id': subject}] if found and offset == 0 else [], 'nextOffset': None}
    if route == 'upcoming/':
        # Live booking/attendance is deliberately excluded from personal study;
        # authored dates remain on the module's schedule and activity details.
        return {'upcoming': []}
    if route:
        return None
    totals = progress(detail, context['module_id'])
    total, done = totals['trackableTotal'], totals['trackableDone']
    percent = totals['progressPercent']
    meta = metadata(detail, module)
    schedule = learning_schedule(context)
    plan = next((row for row in schedule['modules'] if str(row.get('id')) == context['module_id']), None)
    card = {'id': subject, 'moduleId': context['module_id'], 'title': module.get('title') or context['module_id'],
            'source': 'current', 'activityCount': total, 'completedActivityCount': done, 'progress': percent,
            'status': 'Completed' if total and done == total else 'In progress' if done else 'Upcoming',
            'finalTestPassed': totals['finalTestPassed'], 'cover': meta.get('covers', {}).get(subject),
            'planModule': plan, 'actualHours': None}
    return {'learner': {'id': context['id'], 'kind': 'commercial', 'name': detail['name'],
                       'programme': detail['programme'], 'cohort': detail.get('cohort') or '', 'group': detail.get('group') or ''},
            'summary': {'current': {'subjects': 1, 'total': total, 'completed': done, 'percent': percent},
                        'previous': {'subjects': 0, 'total': 0, 'completed': 0, 'percent': 0}, 'subjectCount': 1},
            'modules': [card], 'otjh': {'actual': None, 'planned': None}, 'upcoming': [], 'hasMoreUpcoming': False}
