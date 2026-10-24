"""Pure, request-scoped component review; never infer completion from a title."""
import hashlib
import json
import re

from old_otjh.service import ServiceError

from .replacement_learning import project_replacement_learning


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def activity_type(value, *, quiz=False):
    value = re.sub(r'[^a-z0-9]', '', str(value or '').lower())
    if quiz or value in {'quiz', 'readingquiz'}:
        return 'quiz'
    return {'text': 'reading', 'textlesson': 'reading', 'document': 'reading',
            'audio': 'podcast'}.get(value, value or 'unknown')


def target_fingerprint(component, settings):
    """Bind manual equivalence to the approved target's type and source identity."""
    from .replacement_learning import _object
    legacy = _object(_object(settings).get('legacySettings'))
    return digest({'type': activity_type(component.get('type'), quiz=component.get('isQuiz')),
                   'quizId': (component.get('quizMeta') or {}).get('quizId'),
                   'legacySettings': {key: legacy.get(key) for key in ('sourceLessonId', 'sourceMaterialKey')}})


def module_review(item, context):
    native, definitions, done, metadata = context[3], context[5], context[6], context[9]
    components = [{k: v for k, v in c.items() if k != 'previousLearning'}
                  for c in [*native['components'], *native.get('retiredQuizComponents', [])]
                  if c.get('moduleId') == item['moduleId']]
    course = item['courseRef'][7:]
    refs = sorted(set(item.get('completedSourceActivities',
                              [ref for old, ref in done if str(old) == course])))
    definitions = {d['source_activity_id']: d for d in definitions if str(d['source_course_ref']) == course}
    activities = [{'group_id': int(course), 'catalogue_kind': ref.split(':')[0],
                   'source_activity_id': int(ref.split(':')[1]),
                   'activity_id': f'catalogue:{course}:{ref}', 'completed': True} for ref in refs]
    projected = project_replacement_learning(components, metadata['replacement_settings'],
                                            {'current:' + item['moduleId']: item['courseRef']}, activities)
    matches = {c['componentId']: c['previousLearning'] for c in projected
               if c.get('previousLearning', {}).get('completed') is True}
    automatic = {f"{m['catalogueKind']}:{m['sourceActivityId']}": ident for ident, m in matches.items()}
    sources = []
    for ref in refs:
        d = definitions.get(ref, {})
        sources.append({'sourceActivityRef': ref, 'title': d.get('source_activity_title') or ref,
                        'week': d.get('source_section_title') or '',
                        'type': activity_type(d.get('source_activity_type'), quiz=ref.startswith('quiz:')),
                        'automaticTargetId': automatic.get(ref)})
    targets = [{'componentId': c['componentId'], 'title': c.get('component') or c.get('title') or c['componentId'],
                'week': c.get('week') or '', 'type': activity_type(c.get('type'), quiz=c.get('isQuiz')),
                'plannedHours': c.get('expectedOtjh'),
                'fingerprint': target_fingerprint(c, metadata['replacement_settings'].get(c['componentId']))}
               for c in components if c.get('componentId') and not c.get('retired')]
    return {'moduleId': item['moduleId'], 'courseRef': item['courseRef'], 'title': item['newTitle'],
            'sources': sources, 'targets': targets}, matches, components


def build_review(request_id, items, context):
    modules = [module_review(item, context)[0] for item in items]
    return {'modules': modules, 'reviewToken': digest({'requestId': str(request_id), 'modules': modules})}


def validate_decisions(review, decisions):
    """Require one explicit same-type destination for every unmatched completion."""
    needed = {(module['moduleId'], source['sourceActivityRef']): (module, source)
              for module in review['modules'] for source in module['sources'] if not source['automaticTargetId']}
    if decisions is None and not needed:
        return {}
    if not isinstance(decisions, dict) or decisions.get('reviewToken') != review['reviewToken']:
        raise ServiceError('Component matches changed or have not been reviewed. Reload component matches before confirming.',
                           'transfer_review_changed', 409)
    rows = decisions.get('mappings')
    if not isinstance(rows, list):
        raise ServiceError('Review every unmatched component before confirming.', 'transfer_matches_required', 400)
    used = {(module['moduleId'], source['automaticTargetId']) for module in review['modules']
            for source in module['sources'] if source['automaticTargetId']}
    result = {}
    for row in rows:
        if (not isinstance(row, dict) or set(row) != {'moduleId', 'sourceActivityRef', 'targetComponentId'}
                or any(not isinstance(value, str) or not value for value in row.values())):
            raise ServiceError('Choose a destination for every unmatched component.', 'invalid_transfer_match', 400)
        key = (row['moduleId'], row['sourceActivityRef'])
        if key not in needed or key in result:
            raise ServiceError('A source component is invalid or selected more than once.', 'invalid_transfer_match', 400)
        module, source = needed[key]
        target = next((target for target in module['targets'] if target['componentId'] == row['targetComponentId']), None)
        if (target is None or source['type'] == 'unknown' or source['type'] != target['type']
                or (row['moduleId'], row['targetComponentId']) in used):
            raise ServiceError('Choose a unique component of the same type in the destination module.', 'invalid_transfer_match', 400)
        used.add((row['moduleId'], row['targetComponentId']))
        result[key] = target
    if result.keys() != needed.keys():
        raise ServiceError('Every completed old component must have a match before approval.', 'transfer_matches_required', 409)
    return result


def manual_completion(item, source_ref, target):
    kind, ident = source_ref.split(':')
    return {'courseRef': item['courseRef'], 'activityId': f"catalogue:{item['courseRef'][7:]}:{source_ref}",
            'sourceActivityId': int(ident), 'catalogueKind': kind, 'completed': True,
            'manualMatch': True, 'targetFingerprint': target['fingerprint']}
